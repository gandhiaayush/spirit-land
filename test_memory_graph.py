"""
Tests for memory_graph.py.

Two tiers:
  - Offline structural tests run anywhere (no network): taxonomy, is_a walks, LCA, arm
    switching, the observation adapter, context parsing.
  - Live transfer-beat tests hit real Gemini (embeddings + Strategist) and are SKIPPED
    automatically when no GOOGLE_API_KEY / GEMINI_API_KEY is set. These encode the
    crown-jewel proof: reflective+graph transfers a lesson down an is_a edge; kNN cannot.

Run:  pytest test_memory_graph.py -v
"""

import os

import numpy as np
import pytest

import memory_graph as m

HAS_KEY = bool(os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY"))
live = pytest.mark.skipif(not HAS_KEY, reason="needs GOOGLE_API_KEY / GEMINI_API_KEY")


@pytest.fixture(autouse=True)
def _clean_graph():
    m.reset_graph()
    m.set_active_arm("reflective")
    yield
    m.reset_graph()
    m.set_active_arm("reflective")


def _trees_shrub_batch():
    preds = [{"patch_id": f"t{i}", "true_label": "trees",
              "predicted_label": "shrub_and_scrub", "model_reasoning": "bushy canopy"}
             for i in range(6)]
    preds += [{"patch_id": f"s{i}", "true_label": "shrub_and_scrub",
               "predicted_label": "trees", "model_reasoning": "looked tall"}
              for i in range(4)]
    return preds


# ── offline structural tests ──────────────────────────────────────────────────

def test_taxonomy_seeded():
    assert m.LEAF_CLASSES == {
        "trees", "shrub_and_scrub", "grass", "crops", "flooded_vegetation",
        "water", "snow_and_ice", "built", "bare"}
    assert m._G.nodes["vegetation"]["type"] == "class"


def test_ancestors_walk():
    assert m._ancestors("grass") == ["vegetation", "land_cover"]
    assert m._ancestors("water") == ["aquatic", "land_cover"]
    assert m._ancestors("land_cover") == []


def test_lca_is_the_filing_floor():
    assert m._lca("trees", "shrub_and_scrub") == "vegetation"  # transfer floor
    assert m._lca("grass", "trees") == "vegetation"
    assert m._lca("trees", "water") == "land_cover"            # cross-category → root


def test_arm_switching():
    m.set_active_arm("cold")
    assert m.get_active_arm() == "cold"
    with pytest.raises(ValueError):
        m.set_active_arm("nonsense")


def test_cold_arm_is_inert():
    m.set_active_arm("cold")
    assert m.update_graph(_trees_shrub_batch()) == []
    assert m.get_relevant_heuristics("grass and shrub_and_scrub") == []


def test_observation_adapter_weighting():
    obs = m._to_observations([
        {"true_label": "trees", "predicted_label": "grass"},                 # default weight 1
        {"true_label": "water", "predicted_label": "bare", "pixel_count": 50},
        {"true_label": "crops", "predicted_label": "grass", "weight": 7},
    ])
    assert [o["weight"] for o in obs] == [1.0, 50.0, 7.0]


def test_classes_in_context_parsing():
    found = m._classes_in_context("a batch of grass and shrub_and_scrub near water")
    assert set(found) == {"grass", "shrub_and_scrub", "water"}
    assert m._classes_in_context("batch 3") == []   # graceful degrade


def test_classes_in_context_aliases():
    # natural phrasing — 'shrub' must resolve to shrub_and_scrub (M2 regression guard)
    assert set(m._classes_in_context("grass and shrub patches")) == {"grass", "shrub_and_scrub"}
    assert "built" in m._classes_in_context("dense urban area")
    assert "bare" in m._classes_in_context("barren soil and rock")
    assert "barely" and m._classes_in_context("barely visible") == []   # word-boundary, no false hit


def test_zero_weight_not_coerced():
    obs = m._to_observations([{"true_label": "trees", "predicted_label": "grass", "weight": 0}])
    assert obs[0]["weight"] == 0.0   # M4: explicit 0 stays 0, not bumped to 1


def test_more_general_never_lowers_filing():
    # C1: merging must lift toward the ancestor, never down to a leaf
    assert m._more_general("trees", "vegetation") == "vegetation"
    assert m._more_general("vegetation", "trees") == "vegetation"
    assert m._more_general("trees", "grass") == "vegetation"   # neither contains other → LCA
    assert m._more_general("vegetation", "vegetation") == "vegetation"


def test_empty_graph_retrieval_no_crash():
    # M3: with no memory, retrieval returns [] WITHOUT needing an embed/API call
    m.set_active_arm("reflective")
    assert m.get_relevant_heuristics("grass and shrub") == []
    m.set_active_arm("knn")
    assert m.get_relevant_heuristics("grass and shrub") == []


def test_graph_dump_load_roundtrip(tmp_path):
    m.reset_graph()
    # inject a fake heuristic with a numpy embedding (no API needed) to exercise serialization
    m._G.add_node("heur_test", type="heuristic", text="x", applies_to_class="vegetation",
                  applies_to_confusion_pairs=[["trees", "shrub_and_scrub"]],
                  embedding=np.ones(m.EMBED_DIM, dtype=np.float32),
                  derived_from_error_nodes=[], confidence_weight=1.0,
                  times_applied=0, times_helped=0, created_at="t")
    m._G.add_edge("heur_test", "vegetation", relation="applies_to_class")
    n_nodes, n_edges = m._G.number_of_nodes(), m._G.number_of_edges()

    path = m.dump_graph(str(tmp_path / "g.json"))
    m.reset_graph()
    assert m._G.number_of_nodes() != n_nodes              # wiped
    m.load_graph(path)
    assert m._G.number_of_nodes() == n_nodes              # restored
    assert m._G.number_of_edges() == n_edges
    emb = m._G.nodes["heur_test"]["embedding"]
    assert isinstance(emb, np.ndarray) and emb.shape[0] == m.EMBED_DIM
    assert m._ancestors("grass") == ["vegetation", "land_cover"]   # taxonomy intact + walkable


# ── live transfer-beat tests (the crown jewel) ────────────────────────────────

@live
def test_reflective_files_lesson_on_parent():
    m.set_active_arm("reflective")
    new = m.update_graph(_trees_shrub_batch())
    assert new, "reflective arm should create at least one heuristic"
    classes = {m._G.nodes[n]["applies_to_class"] for n in new}
    # a trees/shrub lesson must be filed at vegetation (or higher) to be transferable
    assert classes & {"vegetation", "land_cover"}


@live
def test_transfer_beat_reflective_vs_knn():
    # Arm C: learn trees↔shrub, then retrieve for a NEVER-SEEN grass↔shrub batch.
    m.set_active_arm("reflective")
    m.update_graph(_trees_shrub_batch())
    got = m.get_relevant_heuristics("a batch of grass and shrub_and_scrub patches", top_k=5)
    assert any(g["applies_to_class"] in ("vegetation", "land_cover") for g in got), \
        "vegetation lesson should transfer down is_a to grass/shrub"

    # Arm B: identical batch + query — kNN has no hierarchy, so nothing generalizes to grass.
    m.reset_graph()
    m.set_active_arm("knn")
    assert m.update_graph(_trees_shrub_batch()) == []      # kNN writes no heuristics
    gotk = m.get_relevant_heuristics("a batch of grass and shrub_and_scrub patches", top_k=5)
    assert all("grass" not in g["text"] for g in gotk), \
        "kNN must not be able to generalize the lesson to grass"


# ── Phase 2: helpers ──────────────────────────────────────────────────────────
import hashlib  # noqa: E402


def _fake_vec(text: str) -> np.ndarray:
    rng = np.random.default_rng(int(hashlib.sha256(text.encode()).hexdigest(), 16) % (2**32))
    return rng.standard_normal(m.EMBED_DIM).astype(np.float32)


def _add_heuristic(node_id, applies_to_class, pairs, text, embedding,
                   confidence=1.0, excluded=None):
    m._G.add_node(node_id, type="heuristic", text=text, applies_to_class=applies_to_class,
                  applies_to_confusion_pairs=[list(p) for p in pairs], embedding=embedding,
                  derived_from_error_nodes=[], confidence_weight=confidence,
                  times_applied=0, times_helped=0,
                  excluded_classes=list(excluded or []), created_at="t")
    if applies_to_class in m._G:
        m._G.add_edge(node_id, applies_to_class, relation="applies_to_class")


# ── Phase 2: embedding cache ──────────────────────────────────────────────────
def test_embedding_cache(monkeypatch):
    calls = {"n": 0}
    def counting_raw(text):
        calls["n"] += 1
        return _fake_vec(text)
    monkeypatch.setattr(m, "_embed_raw", counting_raw)
    m._embed_cache.clear()
    v1, v2 = m._embed("hello"), m._embed("hello")
    assert calls["n"] == 1 and (v1 == v2).all()   # second call served from cache
    m._embed("world")
    assert calls["n"] == 2


# ── Phase 2: multi-hop / distance-weighted structural score ───────────────────
def test_closer_ancestor_outranks_root(monkeypatch):
    monkeypatch.setattr(m, "_embed", _fake_vec)
    m.set_active_arm("reflective")
    _add_heuristic("h_veg", "vegetation", [("trees", "shrub_and_scrub")], "veg", _fake_vec("veg"))
    _add_heuristic("h_root", "land_cover", [("trees", "water")], "root", _fake_vec("root"))
    ids = [g["node_id"] for g in m.get_relevant_heuristics("a batch of grass patches", top_k=2)]
    assert ids[0] == "h_veg" and ids[1] == "h_root"   # 1 hop beats 2 hops


def test_root_lesson_transfers_across_categories(monkeypatch):
    monkeypatch.setattr(m, "_embed", _fake_vec)
    m.set_active_arm("reflective")
    _add_heuristic("h_root", "land_cover", [("trees", "water")], "shadows", _fake_vec("shadows"))
    ids = [g["node_id"] for g in m.get_relevant_heuristics("built and bare patches", top_k=3)]
    assert "h_root" in ids   # multi-hop: a root lesson reaches built/bare


# ── Phase 2: times_helped feedback + anti-transfer ────────────────────────────
def test_feedback_promotes_on_improvement():
    _add_heuristic("h1", "vegetation", [("trees", "shrub_and_scrub")], "x",
                   np.ones(m.EMBED_DIM, dtype=np.float32))
    m._active_retrieved = {"h1": {"pairs": [("trees", "shrub_and_scrub")], "transfer_targets": set()}}
    m._prev_pair_error = {("trees", "shrub_and_scrub"): 0.5}
    m._apply_feedback({("trees", "shrub_and_scrub"): 0.2}, {})
    assert m._G.nodes["h1"]["times_helped"] == 1
    assert m._G.nodes["h1"]["confidence_weight"] == 1.0 + m.PROMOTE_STEP


def test_feedback_demotes_on_regression():
    _add_heuristic("h1", "vegetation", [("trees", "shrub_and_scrub")], "x",
                   np.ones(m.EMBED_DIM, dtype=np.float32))
    m._active_retrieved = {"h1": {"pairs": [("trees", "shrub_and_scrub")], "transfer_targets": set()}}
    m._prev_pair_error = {("trees", "shrub_and_scrub"): 0.2}
    m._apply_feedback({("trees", "shrub_and_scrub"): 0.5}, {})
    assert m._G.nodes["h1"]["times_helped"] == 0
    assert m._G.nodes["h1"]["confidence_weight"] == 1.0 - m.DEMOTE_STEP


def test_anti_transfer_excludes_class_one_strike():
    _add_heuristic("h1", "vegetation", [("trees", "shrub_and_scrub")], "x",
                   np.ones(m.EMBED_DIM, dtype=np.float32))
    m._active_retrieved = {"h1": {"pairs": [], "transfer_targets": {"grass"}}}
    m._prev_class_error = {"grass": 0.2}
    m._apply_feedback({}, {"grass": 0.5})        # grass got worse after transfer
    assert "grass" in m._G.nodes["h1"]["excluded_classes"]
    assert m._G.nodes["h1"]["confidence_weight"] == 1.0 - m.DEMOTE_STEP


def test_excluded_class_loses_structural_boost(monkeypatch):
    monkeypatch.setattr(m, "_embed", _fake_vec)
    m.set_active_arm("reflective")
    _add_heuristic("h_excl", "vegetation", [("trees", "shrub_and_scrub")], "a",
                   _fake_vec("a"), excluded=["grass"])
    _add_heuristic("h_ok", "vegetation", [("trees", "shrub_and_scrub")], "b", _fake_vec("b"))
    ids = [g["node_id"] for g in m.get_relevant_heuristics("a batch of grass patches", top_k=2)]
    assert ids[0] == "h_ok"   # excluded heuristic forfeits its grass transfer


# ── Phase 2: active-learning signal ───────────────────────────────────────────
def test_suggest_focus_classes_ranks_by_error_mass():
    m._G.add_node("e1", type="error_pattern", confusion_pair=["trees", "shrub_and_scrub"], frequency=10.0)
    m._G.add_node("e2", type="error_pattern", confusion_pair=["grass", "crops"], frequency=3.0)
    m._G.add_node("e3", type="error_pattern", confusion_pair=["trees", "grass"], frequency=5.0)
    assert m.suggest_focus_classes(2) == ["trees", "grass"]   # trees 15, grass 3


# ── Phase 2: config source-of-truth drift guard ───────────────────────────────
def test_config_label_drift_guard():
    try:
        import config  # type: ignore
    except Exception:
        pytest.skip("config.py not present (PR #3 not merged)")
    assert set(m.LEAF_CLASSES) == set(config.DW_CLASSES)


def test_set_active_arm_clears_active_retrieved():
    m._active_retrieved = {"h_stale": {"pairs": [], "transfer_targets": set()}}
    m.set_active_arm("knn")        # M1: arm switch must drop the stale applied-set
    assert m._active_retrieved == {}


def test_feedback_caps_one_step_per_batch():
    # M2: two own pairs both improving → exactly ONE promote, times_helped += 1 (not 2)
    _add_heuristic("h1", "vegetation",
                   [("trees", "shrub_and_scrub"), ("grass", "shrub_and_scrub")], "x",
                   np.ones(m.EMBED_DIM, dtype=np.float32))
    m._active_retrieved = {"h1": {"pairs": [("trees", "shrub_and_scrub"),
                                            ("grass", "shrub_and_scrub")], "transfer_targets": set()}}
    m._prev_pair_error = {("trees", "shrub_and_scrub"): 0.5, ("grass", "shrub_and_scrub"): 0.5}
    m._apply_feedback({("trees", "shrub_and_scrub"): 0.1, ("grass", "shrub_and_scrub"): 0.1}, {})
    assert m._G.nodes["h1"]["times_helped"] == 1
    assert m._G.nodes["h1"]["confidence_weight"] == 1.0 + m.PROMOTE_STEP
