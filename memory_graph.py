"""
Engineer 2's module — Memory & Graph Structure.

A networkx in-memory graph of land-cover *classes* (a fixed `is_a` taxonomy), the
*error patterns* the system has observed, and the plain-language *heuristics* it has
reflected into. The crown-jewel behavior: a lesson learned on one confusion pair
(trees↔shrub) transfers to a never-seen pair (grass↔shrub) by walking `is_a` upward —
something flat-vector kNN retrieval cannot do.

Three swappable ablation arms (the demo's proof harness), selected via set_active_arm():
  - "cold"       : no memory at all (the floor).
  - "knn"        : raw retrieval of past error-pattern exemplars; NO hierarchy.
  - "reflective" : LLM-written heuristics filed on hierarchy nodes + is_a transfer (default).

Gemini does two jobs here (don't conflate): the *Strategist* (gemini-2.5-flash) writes
heuristics in update_graph; *embeddings* (gemini-embedding-001) key similarity retrieval.
The frozen interface — get_relevant_heuristics() / update_graph() — is unchanged; the arm
is the only side channel, so no other engineer's code breaks.
"""

import dataclasses
import json
import os
import re
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import networkx as nx
import numpy as np
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

# ── tuning knobs (locked defaults; models env-overridable for the hackathon env) ─
EMBED_MODEL = os.environ.get("SUBSTRATA_EMBED_MODEL", "gemini-embedding-001")
STRATEGIST_MODEL = os.environ.get("SUBSTRATA_STRATEGIST_MODEL", "gemini-2.5-flash")
EMBED_DIM = 768
FREQ_GATE_T = 3          # only reflect on a confusion pair once cumulative frequency ≥ T
TOP_K_PAIRS = 3          # reflect on at most this many pairs per batch (bounds LLM calls)
DEDUP_COSINE = 0.85      # merge a new heuristic into an existing one above this similarity
_STRUCTURAL_SCORE = 1.0  # base score for an is_a-matched heuristic filed AT the batch class
_STRUCT_DECAY = 0.8      # structural score × decay^(hop distance) — closer ancestors rank higher
# Phase 2 feedback tuning (aggressive 1-strike, for a short dramatic demo)
PROMOTE_STEP = 0.5       # confidence bump when a heuristic helps (≤ once per batch)
DEMOTE_STEP = 0.5        # confidence cut when it regresses (≤ once per batch)
MIN_CONFIDENCE = 0.1     # confidence floor
MAX_CONFIDENCE = 5.0     # confidence ceiling — stops a veteran heuristic starving newer ones
ANTI_TRANSFER_STRIKES = 1  # regressions on a transferred class before excluding it

# ── ablation arm (side channel — the frozen signatures can't take a mode arg) ──
_VALID_ARMS = {"cold", "knn", "reflective"}
_ARM = os.environ.get("SUBSTRATA_MEMORY_ARM", "reflective")
if _ARM not in _VALID_ARMS:
    _ARM = "reflective"


def set_active_arm(arm: str) -> None:
    """Select the ablation arm: 'cold' | 'knn' | 'reflective'. Called by the orchestrator
    (driven by the dashboard toggle) before a run. Affects both retrieval and update."""
    global _ARM
    if arm not in _VALID_ARMS:
        raise ValueError(f"unknown arm {arm!r}; expected one of {sorted(_VALID_ARMS)}")
    _ARM = arm
    _active_retrieved.clear()   # M1: switching arms must not carry a stale applied-set into feedback


def get_active_arm() -> str:
    return _ARM


# ── class taxonomy (CLOSED set: Dynamic World's 9 leaf classes) ───────────────
# Source of truth is E1's config.py when present; otherwise this built-in copy. Both are
# given in the natural form where a category may share a leaf's name (e.g. "water"); the
# resolver below disambiguates those collisions into distinct internal category nodes
# (water→aquatic, built→built_up, bare→barren) so a leaf never self-loops with its parent.
_BUILTIN_HIERARCHY = {
    "land_cover": ["vegetation", "built", "bare", "water"],
    "vegetation": ["trees", "shrub_and_scrub", "grass", "crops", "flooded_vegetation"],
    "built": ["built"],
    "bare": ["bare"],
    "water": ["water", "snow_and_ice"],
}
_BUILTIN_LEAVES = {"trees", "shrub_and_scrub", "grass", "crops", "flooded_vegetation",
                   "water", "snow_and_ice", "built", "bare"}
_CATEGORY_ALIAS = {"water": "aquatic", "built": "built_up", "bare": "barren"}

LEAF_CLASSES: set[str] = set()   # populated by _build_taxonomy()
_G = nx.DiGraph()


def _taxonomy_source() -> tuple[dict, set]:
    """E1's config.py is the source of truth when importable; else the built-in copy."""
    try:
        import config  # type: ignore
        hierarchy = getattr(config, "CLASS_HIERARCHY", None)
        leaves = getattr(config, "DW_CLASSES", None)
        if hierarchy and leaves:
            return dict(hierarchy), set(leaves)
    except Exception:
        pass
    return _BUILTIN_HIERARCHY, set(_BUILTIN_LEAVES)


def _category_name(name: str, leaves: set) -> str:
    """A category whose name collides with a leaf gets a distinct internal id."""
    if name in leaves:
        return _CATEGORY_ALIAS.get(name, name + "_group")
    return name


def _build_taxonomy() -> None:
    """Seed the fixed is_a backbone (child --is_a--> parent), disambiguating any
    category/leaf name collisions. Works identically on config or the built-in copy."""
    global LEAF_CLASSES
    hierarchy, leaves = _taxonomy_source()
    leaf_set: set[str] = set()
    for parent, children in hierarchy.items():
        P = _category_name(parent, leaves)
        _G.add_node(P, type="class")
        for child in children:
            if child == parent:                    # self-reference → category's sole leaf
                node, is_leaf = child, True
            elif child in hierarchy:               # a sub-category
                node, is_leaf = _category_name(child, leaves), False
            else:                                  # a leaf class
                node, is_leaf = child, True
            _G.add_node(node, type="class")
            _G.add_edge(node, P, relation="is_a")
            if is_leaf:
                leaf_set.add(node)
    LEAF_CLASSES = leaf_set


_build_taxonomy()

# ── Phase 2 cross-batch feedback state (reset in reset_graph; NOT the embed cache) ─
_prev_pair_error: dict[tuple, float] = {}    # last batch's per-pair error RATE
_prev_class_error: dict[str, float] = {}     # last batch's per-true-class error RATE
_active_retrieved: dict[str, dict] = {}      # heuristics injected last retrieval + their targets


def add_class(name: str, parent: str) -> None:
    """Hand-curated taxonomy extension. NOT called during a run — the Strategist grows
    memory (errors/heuristics), never the ontology."""
    _G.add_node(name, type="class")
    _G.add_edge(name, parent, relation="is_a")


# ── taxonomy walks (the transfer mechanism) ───────────────────────────────────

def _ancestors(cls: str) -> list[str]:
    """Climb is_a from a class to the root, e.g. grass → ['vegetation', 'land_cover'].
    The taxonomy is a tree (single parent), so a simple climb suffices."""
    out: list[str] = []
    cur = cls
    while cur in _G:
        parents = [p for p in _G.successors(cur)
                   if _G.edges[cur, p].get("relation") == "is_a"]
        if not parents:
            break
        cur = parents[0]
        out.append(cur)
    return out


def _lca(a: str, b: str) -> str:
    """Lowest common ancestor of two classes — the default node to file a lesson on.
    LCA(trees, shrub_and_scrub) == 'vegetation'."""
    a_chain = [a] + _ancestors(a)
    b_set = {b, *_ancestors(b)}
    for node in a_chain:
        if node in b_set:
            return node
    return "land_cover"


def _more_general(a: str, b: str) -> str:
    """The more general (higher) of two filing classes; their LCA if neither contains the
    other. Used on dedup-merge so a merge never *lowers* a heuristic's filing node and
    silently breaks transfer."""
    if a == b:
        return a
    if a in _ancestors(b):   # a is an ancestor of b → a is more general
        return a
    if b in _ancestors(a):
        return b
    return _lca(a, b)


# ── Gemini client + seams ─────────────────────────────────────────────────────
_client_singleton: genai.Client | None = None


def _client() -> genai.Client:
    global _client_singleton
    if _client_singleton is None:
        api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise EnvironmentError(
                "Set GOOGLE_API_KEY or GEMINI_API_KEY in your environment or .env file")
        _client_singleton = genai.Client(api_key=api_key)
    return _client_singleton


_embed_cache: dict[str, np.ndarray] = {}


def _embed_raw(text: str) -> np.ndarray:
    resp = _client().models.embed_content(
        model=EMBED_MODEL,
        contents=[text],
        config=types.EmbedContentConfig(output_dimensionality=EMBED_DIM),
    )
    return np.asarray(resp.embeddings[0].values, dtype=np.float32)


def _embed(text: str) -> np.ndarray:
    """Cached embedding — identical text never re-pays Gemini. Cache survives reset_graph
    (text→vector is stable)."""
    cached = _embed_cache.get(text)
    if cached is None:
        cached = _embed_raw(text)
        _embed_cache[text] = cached
    return cached


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def _strategist(true_label: str, predicted_label: str, allowed_classes: list[str],
                sample_reasonings: list[str]) -> dict:
    """Reflect on a confusion pair → a 1-2 sentence discriminative heuristic, filed on the
    highest hierarchy node where it still holds. The filing class is *constrained* to
    `allowed_classes` (LCA up to root); we validate and snap back to the LCA on any miss."""
    lca = allowed_classes[0]
    reasonings = "\n".join(f"- {r}" for r in sample_reasonings[:5]) or "- (none captured)"
    prompt = (
        f"You are the Strategist for a self-improving land-cover classifier.\n"
        f"The model keeps confusing true class '{true_label}' with '{predicted_label}'.\n"
        f"Sample reasonings from its wrong calls:\n{reasonings}\n\n"
        f"Write ONE reusable visual heuristic (1-2 sentences) that tells these classes apart "
        f"from satellite RGB — concrete cues only (texture, height, shadow, color, shape).\n"
        f"Then choose the SINGLE class-hierarchy node this lesson should be filed on, picking "
        f"the HIGHEST node where it still discriminates so it generalizes to sibling classes.\n"
        f"`applies_to_class` MUST be exactly one of: {allowed_classes}."
    )
    schema = types.Schema(
        type=types.Type.OBJECT,
        properties={
            "text": types.Schema(type=types.Type.STRING),
            "applies_to_class": types.Schema(type=types.Type.STRING, enum=allowed_classes),
        },
        required=["text", "applies_to_class"],
    )
    resp = _client().models.generate_content(
        model=STRATEGIST_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json", response_schema=schema),
    )
    data = resp.parsed if isinstance(resp.parsed, dict) else {}
    text = (data.get("text") or "").strip()
    filed = data.get("applies_to_class")
    if filed not in allowed_classes:   # validate-or-snap-back: no bad edges ever get written
        filed = lca
    return {"text": text or f"Distinguish {true_label} from {predicted_label} by visual texture.",
            "applies_to_class": filed}


# ── observation adapter (granularity-agnostic: patch now, per-pixel later) ─────

def _to_observations(predictions: list[dict]) -> list[dict]:
    """Normalize whatever update_graph is handed into weighted confusion observations.
    Today: one observation per patch PredictionRecord, weight 1 (or pixel_count if present).
    Later (per-pixel): an upstream adapter emits region observations with weight=pixel-count;
    this function's output contract is the only thing that needs to stay stable."""
    obs = []
    for p in predictions:
        if dataclasses.is_dataclass(p) and not isinstance(p, type):
            p = dataclasses.asdict(p)   # accept PredictionRecord dataclasses too, defensively
        w = p.get("weight")
        if w is None:
            w = p.get("pixel_count")
        if w is None:
            w = 1
        weight = float(w)   # explicit None checks: a real 0-weight stays 0, never coerced to 1
        obs.append({
            "true": p.get("true_label"),
            "pred": p.get("predicted_label"),
            "weight": weight,
            "evidence_id": p.get("patch_id") or p.get("tile_id"),
            "reasoning": p.get("model_reasoning", ""),
        })
    return obs


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── ErrorPattern + Heuristic node helpers ─────────────────────────────────────

def _find_error_pattern(pair: tuple[str, str]) -> str | None:
    for n, d in _G.nodes(data=True):
        if d.get("type") == "error_pattern" and tuple(d["confusion_pair"]) == pair:
            return n
    return None


def _upsert_error_pattern(pair: tuple[str, str], weight: float,
                          evidence_ids: list[str]) -> str:
    node_id = _find_error_pattern(pair)
    if node_id is None:
        node_id = f"err_{uuid.uuid4().hex[:8]}"
        _G.add_node(
            node_id, type="error_pattern", confusion_pair=list(pair),
            description=f"{pair[0]} misclassified as {pair[1]}",
            embedding=_embed(f"{pair[0]} misclassified as {pair[1]}"),
            supporting_evidence_ids=[e for e in evidence_ids if e],
            frequency=weight, created_at=_now(), last_updated=_now(),
        )
    else:
        d = _G.nodes[node_id]
        d["frequency"] += weight
        d["supporting_evidence_ids"].extend(e for e in evidence_ids if e)
        d["last_updated"] = _now()
    return node_id


def _heuristic_nodes() -> list[str]:
    return [n for n, d in _G.nodes(data=True) if d.get("type") == "heuristic"]


def _derived_classes(d: dict) -> set:
    """The leaf classes a heuristic was originally learned from (its own confusion pairs).
    A batch class outside this set that the heuristic still matches = a *transfer*."""
    out: set = set()
    for pair in d.get("applies_to_confusion_pairs", []):
        out.update(pair)
    return out


def _add_or_merge_heuristic(text: str, applies_to_class: str, pair: tuple[str, str],
                            error_node_id: str) -> tuple[str, bool]:
    """Embed the new lesson; if it's near-duplicate of an existing heuristic, merge into it
    (bump confidence, extend coverage). Otherwise create a new heuristic node + edges.
    Returns (node_id, created)."""
    emb = _embed(text)
    best_id, best_sim = None, 0.0
    for n in _heuristic_nodes():
        sim = _cosine(emb, _G.nodes[n]["embedding"])
        if sim > best_sim:
            best_id, best_sim = n, sim

    if best_id is not None and best_sim >= DEDUP_COSINE:
        d = _G.nodes[best_id]
        d["confidence_weight"] = min(MAX_CONFIDENCE, d["confidence_weight"] + PROMOTE_STEP)
        if list(pair) not in d["applies_to_confusion_pairs"]:
            d["applies_to_confusion_pairs"].append(list(pair))
        if error_node_id not in d["derived_from_error_nodes"]:
            d["derived_from_error_nodes"].append(error_node_id)
        _G.add_edge(best_id, error_node_id, relation="derived_from")
        # C1: a merge must never LOWER the filing node, or transfer silently dies.
        # Lift to the more general of (existing filing, incoming filing) and re-point the edge.
        old_class = d.get("applies_to_class")
        lifted = _more_general(old_class, applies_to_class) if old_class else applies_to_class
        if lifted != old_class:
            if old_class is not None and _G.has_edge(best_id, old_class):
                _G.remove_edge(best_id, old_class)
            d["applies_to_class"] = lifted
            if lifted in _G:
                _G.add_edge(best_id, lifted, relation="applies_to_class")
        return best_id, False

    node_id = f"heur_{uuid.uuid4().hex[:8]}"
    _G.add_node(
        node_id, type="heuristic", text=text, applies_to_class=applies_to_class,
        applies_to_confusion_pairs=[list(pair)], embedding=emb,
        derived_from_error_nodes=[error_node_id], confidence_weight=1.0,
        times_applied=0, times_helped=0, excluded_classes=[], created_at=_now(),
    )
    _G.add_edge(node_id, error_node_id, relation="derived_from")
    if applies_to_class in _G:
        _G.add_edge(node_id, applies_to_class, relation="applies_to_class")
    return node_id, True


# ── public: serialization shapes ──────────────────────────────────────────────

def _heuristic_public(node_id: str) -> dict:
    d = _G.nodes[node_id]
    return {
        "node_id": node_id, "type": "heuristic", "text": d["text"],
        "applies_to_class": d.get("applies_to_class"),
        "applies_to_confusion_pairs": d["applies_to_confusion_pairs"],
        "embedding": d["embedding"].tolist(),
        "confidence_weight": d["confidence_weight"],
        "times_applied": d["times_applied"], "times_helped": d["times_helped"],
    }


def _exemplar_public(node_id: str) -> dict:
    """kNN arm: a raw past-confusion exemplar, shaped to the same dict contract the
    classifier injects. No abstraction, no hierarchy — the honest baseline."""
    d = _G.nodes[node_id]
    t, p = d["confusion_pair"]
    return {
        "node_id": node_id, "type": "exemplar",
        "text": f"You have previously confused '{t}' with '{p}' "
                f"({int(d['frequency'])}x). Look carefully before labeling either.",
        "applies_to_confusion_pairs": [list(d["confusion_pair"])],
        "embedding": d["embedding"].tolist(),
        "confidence_weight": 1.0, "times_applied": 0, "times_helped": 0,
    }


# ── retrieval ─────────────────────────────────────────────────────────────────

# Natural-language aliases → canonical Dynamic World leaf class. Exact leaf ids like
# "shrub_and_scrub" rarely appear verbatim in a Gemma summary ("grass and shrub patches"),
# so we match on synonyms, not just the underscore id.
_CLASS_ALIASES: dict[str, list[str]] = {
    "trees": ["trees", "tree", "forest", "forested", "canopy", "woodland"],
    "shrub_and_scrub": ["shrub_and_scrub", "shrub", "shrubs", "scrub", "bush", "bushes"],
    "grass": ["grass", "grassland", "grasses", "meadow", "savanna"],
    "crops": ["crops", "crop", "cropland", "farmland", "agriculture", "agricultural"],
    "flooded_vegetation": ["flooded_vegetation", "flooded", "wetland", "wetlands", "marsh", "mangrove"],
    "water": ["water", "lake", "lakes", "river", "rivers", "ocean", "sea"],
    "snow_and_ice": ["snow_and_ice", "snow", "ice", "glacier", "glaciers"],
    "built": ["built", "built-up", "urban", "city", "building", "buildings", "developed"],
    "bare": ["bare", "barren", "soil", "sand", "desert", "rock", "rocky"],
}
_ALIAS_PATTERNS = {leaf: re.compile(r"\b(" + "|".join(re.escape(a) for a in aliases) + r")\b")
                   for leaf, aliases in _CLASS_ALIASES.items()}


def _classes_in_context(batch_context: str) -> list[str]:
    """Pull known classes out of the batch context via a synonym map so the is_a walk fires
    even on natural phrasing ('grass and shrub' → grass, shrub_and_scrub) or a thin context
    ('batch 3' → none → structural transfer simply contributes nothing this call)."""
    ctx = batch_context.lower()
    return [leaf for leaf, pat in _ALIAS_PATTERNS.items() if pat.search(ctx)]


def get_relevant_heuristics(batch_context: str, top_k: int = 5) -> list[dict]:
    """Retrieve the most relevant memory for the upcoming batch, injected into the
    classifier prompt. Behavior depends on the active arm (see module docstring)."""
    _active_retrieved.clear()            # forget the previous batch's applied set
    if _ARM == "cold":
        return []

    if _ARM == "knn":
        # nearest raw error-pattern exemplars by embedding similarity — no is_a walk.
        eps = [n for n, d in _G.nodes(data=True) if d.get("type") == "error_pattern"]
        if not eps:                      # nothing to score — don't waste an embed call
            return []
        query = _embed(batch_context)
        scored = sorted(eps, key=lambda n: _cosine(query, _G.nodes[n]["embedding"]),
                        reverse=True)
        return [_exemplar_public(n) for n in scored[:top_k]]

    # reflective: similarity over heuristics, UNIONed with the is_a structural walk.
    heuristics = _heuristic_nodes()
    if not heuristics:                   # no memory yet (e.g. batch 1) — skip the embed call
        return []
    query = _embed(batch_context)
    classes = _classes_in_context(batch_context)
    # each batch class → its ancestor chain with hop distance (0 = the class itself)
    chains = {c: [c] + _ancestors(c) for c in classes}

    scores: dict[str, float] = {}
    transfer_targets: dict[str, set] = {}
    for n in heuristics:
        d = _G.nodes[n]
        apc = d.get("applies_to_class")
        excluded = set(d.get("excluded_classes") or [])
        derived = _derived_classes(d)
        s = _cosine(query, d["embedding"])
        best_struct, targets = 0.0, set()
        for c, chain in chains.items():
            if c in excluded:            # anti-transfer guard: this lesson backfired here
                continue
            if apc in chain:
                dist = chain.index(apc)  # 0 = filed on the class, 1 = parent, 2 = grandparent…
                best_struct = max(best_struct, _STRUCTURAL_SCORE * (_STRUCT_DECAY ** dist))
                if c not in derived:     # applied to c via TRANSFER, not its origin
                    targets.add(c)
        scores[n] = max(s, best_struct)  # closer ancestors outrank root (multi-hop sanity)
        transfer_targets[n] = targets

    ranked = sorted(scores, key=lambda n: scores[n] * _G.nodes[n]["confidence_weight"],
                    reverse=True)[:top_k]
    for n in ranked:
        _G.nodes[n]["times_applied"] += 1
        _active_retrieved[n] = {
            "pairs": [tuple(p) for p in _G.nodes[n]["applies_to_confusion_pairs"]],
            "transfer_targets": transfer_targets.get(n, set()),
        }
    return [_heuristic_public(n) for n in ranked]


# ── update ────────────────────────────────────────────────────────────────────

def _apply_feedback(pair_rate: dict, class_error: dict) -> None:
    """times_helped + anti-transfer. For each heuristic injected last retrieval, compare this
    batch's error to last batch's: promote/demote confidence on its own pairs, and (1-strike)
    exclude any transferred-into class whose error got worse."""
    for hid, info in _active_retrieved.items():
        if hid not in _G:
            continue
        d = _G.nodes[hid]
        helped = regressed = False
        for pair in info["pairs"]:                    # the heuristic's own confusion pairs
            cur, prev = pair_rate.get(pair), _prev_pair_error.get(pair)
            if cur is None or prev is None:
                continue
            if cur < prev - 1e-9:
                helped = True
            elif cur > prev + 1e-9:
                regressed = True
        for c in info["transfer_targets"]:            # classes reached only via is_a transfer
            cur, prev = class_error.get(c), _prev_class_error.get(c)
            if cur is not None and prev is not None and cur > prev + 1e-9:
                excl = d.setdefault("excluded_classes", [])
                if c not in excl:                     # 1-strike: stop transferring here
                    excl.append(c)
                regressed = True
        # M2: at most ONE promote and ONE demote per heuristic per batch (signal, not pair count)
        if helped:
            d["times_helped"] += 1
            d["confidence_weight"] = min(MAX_CONFIDENCE, d["confidence_weight"] + PROMOTE_STEP)
        if regressed:
            d["confidence_weight"] = max(MIN_CONFIDENCE, d["confidence_weight"] - DEMOTE_STEP)


def update_graph(predictions: list[dict]) -> list[str]:
    """Analyze a completed batch, record error patterns, and (reflective arm) reflect new
    heuristics into the graph. Returns newly created heuristic node_ids."""
    if _ARM == "cold":
        return []

    observations = _to_observations(predictions)
    true_support: dict[str, float] = defaultdict(float)
    pair_weight: dict[tuple[str, str], float] = defaultdict(float)
    pair_evidence: dict[tuple[str, str], list[str]] = defaultdict(list)
    pair_reasonings: dict[tuple[str, str], list[str]] = defaultdict(list)
    for o in observations:
        if o["true"] is None:
            continue
        true_support[o["true"]] += o["weight"]          # every patch of this true class
        if o["pred"] is None or o["true"] == o["pred"]:
            continue
        pair = (o["true"], o["pred"])
        pair_weight[pair] += o["weight"]
        if o["evidence_id"]:
            pair_evidence[pair].append(o["evidence_id"])
        if o["reasoning"]:
            pair_reasonings[pair].append(o["reasoning"])

    # this batch's per-pair + per-true-class error RATES (row-normalized by true support)
    pair_rate = {pair: pair_weight[pair] / true_support[pair[0]]
                 for pair in pair_weight if true_support.get(pair[0])}
    class_error: dict[str, float] = defaultdict(float)
    for pair, rate in pair_rate.items():
        class_error[pair[0]] += rate

    # both knn and reflective accumulate raw error patterns (kNN's exemplar substrate).
    error_node: dict[tuple[str, str], str] = {}
    for pair, weight in pair_weight.items():
        error_node[pair] = _upsert_error_pattern(pair, weight, pair_evidence[pair])

    if _ARM == "knn":
        return []   # exemplars only — no reflection, no heuristics

    # Did last batch's injected heuristics actually help? Score them BEFORE overwriting the
    # previous-batch baselines (times_helped / confidence promote-demote / anti-transfer).
    _apply_feedback(pair_rate, dict(class_error))
    global _prev_pair_error, _prev_class_error
    _prev_pair_error = dict(pair_rate)
    _prev_class_error = dict(class_error)

    # reflective: gate on cumulative frequency, prioritize the top-K heaviest pairs.
    gated = [pair for pair in pair_weight
             if _G.nodes[error_node[pair]]["frequency"] >= FREQ_GATE_T]
    gated.sort(key=lambda pair: _G.nodes[error_node[pair]]["frequency"], reverse=True)

    new_ids: list[str] = []
    for pair in gated[:TOP_K_PAIRS]:
        true_label, predicted_label = pair
        lca = _lca(true_label, predicted_label)
        allowed = [lca] + _ancestors(lca)               # LCA up to root — the filing floor
        lesson = _strategist(true_label, predicted_label, allowed, pair_reasonings[pair])
        node_id, created = _add_or_merge_heuristic(
            lesson["text"], lesson["applies_to_class"], pair, error_node[pair])
        if created:
            new_ids.append(node_id)
    return new_ids


# ── debug / future graph viz ──────────────────────────────────────────────────

def export_graph() -> dict:
    """JSON-able snapshot (embeddings dropped) for inspection / a future dashboard graph view."""
    nodes = []
    for n, d in _G.nodes(data=True):
        nodes.append({k: v for k, v in d.items() if k != "embedding"} | {"id": n})
    edges = [{"source": u, "target": v, "relation": d.get("relation")}
             for u, v, d in _G.edges(data=True)]
    return {"nodes": nodes, "edges": edges, "arm": _ARM}


def suggest_focus_classes(top_n: int = 3) -> list[str]:
    """Active-learning signal: the true-classes carrying the most outstanding error mass
    (Σ ErrorPattern.frequency where the class is the TRUE label). The orchestrator emits these
    so the next batch can be composed to attack the hardest confusions."""
    mass: dict[str, float] = defaultdict(float)
    for _, d in _G.nodes(data=True):
        if d.get("type") == "error_pattern":
            mass[d["confusion_pair"][0]] += d.get("frequency", 0.0)
    return sorted(mass, key=lambda c: mass[c], reverse=True)[:top_n]


def reset_graph() -> None:
    """Wipe learned memory and re-seed the taxonomy (used between ablation arms / tests).
    NOTE: this deliberately does NOT change the active arm — call set_active_arm() yourself
    before/after if you want a specific arm; the graph and the arm are independent state.
    The embedding cache is intentionally preserved (text→vector is stable)."""
    global _G, _prev_pair_error, _prev_class_error, _active_retrieved
    _G = nx.DiGraph()
    _build_taxonomy()
    _prev_pair_error = {}
    _prev_class_error = {}
    _active_retrieved = {}


# ── durable persistence (optional) ────────────────────────────────────────────
# The working graph lives in memory; these helpers let a "trained" graph survive a
# process restart (e.g. reload it for the demo instead of re-paying Gemini). JSON is the
# default sink, but this is the single seam where a Mongo/Atlas backend would slot in —
# everything else in the module is storage-agnostic.
_GRAPH_STATE_FILE = "graph_state.json"


def dump_graph(path: str = _GRAPH_STATE_FILE) -> str:
    """Serialize the whole graph to JSON (numpy embeddings → lists). Returns the path."""
    data = nx.node_link_data(_G, edges="links")
    for node in data["nodes"]:
        emb = node.get("embedding")
        if emb is not None and hasattr(emb, "tolist"):
            node["embedding"] = emb.tolist()
    Path(path).write_text(json.dumps(data))
    return path


def load_graph(path: str = _GRAPH_STATE_FILE) -> nx.DiGraph:
    """Replace the in-memory graph with one loaded from JSON (lists → numpy embeddings)."""
    global _G
    data = json.loads(Path(path).read_text())
    g = nx.node_link_graph(data, directed=True, multigraph=False, edges="links")
    for _, d in g.nodes(data=True):
        if d.get("embedding") is not None:
            d["embedding"] = np.asarray(d["embedding"], dtype=np.float32)
    _G = g
    return _G
