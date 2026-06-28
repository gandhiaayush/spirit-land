import os
import subprocess

from dotenv import load_dotenv
load_dotenv()

GCP_PROJECT = os.environ.get("GCP_PROJECT", "ai-hack-sf26sfo-7095")
GCP_LOCATION = os.environ.get("GCP_LOCATION", "us-central1")

# Accept either env-var name (memory_graph.py / persistence.py use the same fallback).
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash")
GEMMA_MODEL = os.environ.get("GEMMA_MODEL", "gemma-4-26b-a4b-it-maas")

# Dynamic World 9 classes (label int → class name)
DW_LABEL_TO_CLASS = {
    0: "water",
    1: "trees",
    2: "grass",
    3: "flooded_vegetation",
    4: "crops",
    5: "shrub_and_scrub",
    6: "built",
    7: "bare",
    8: "snow_and_ice",
}
DW_CLASSES = list(DW_LABEL_TO_CLASS.values())

# is_a class hierarchy — Engineer 2 encodes this in the graph
CLASS_HIERARCHY = {
    "land_cover": ["vegetation", "built", "bare", "water"],
    "vegetation": ["trees", "shrub_and_scrub", "grass", "crops", "flooded_vegetation"],
    "built": ["built"],
    "bare": ["bare"],
    "water": ["water", "snow_and_ice"],
}

# Ordered by canopy height/woodiness — basis for heuristic transfer
VEGETATION_CLUSTER = [
    "trees",
    "shrub_and_scrub",
    "grass",
    "crops",
    "flooded_vegetation",
]

# Demo region: Northern California Central Valley (crops, grass, shrub, trees)
DEMO_REGION_BBOX = [-122.55, 37.55, -122.05, 38.00]  # SF Bay: water + urban + hills (distinct classes)  # [west, south, east, north]
DEMO_GRID_SIZE = 15  # 8×8 = 64 patches per scene
DEMO_SCALE_M = 100  # 100 m/pixel for GEE pulls — fast, sufficient for Gemini


def get_credentials():
    """
    Build Google OAuth2 credentials from the active gcloud login.
    Works after `gcloud auth login` — no ADC or service account key needed.
    """
    from google.oauth2.credentials import Credentials

    sa_key = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")
    if sa_key and os.path.exists(sa_key):
        from google.oauth2 import service_account

        return service_account.Credentials.from_service_account_file(
            sa_key,
            scopes=[
                "https://www.googleapis.com/auth/cloud-platform",
                "https://www.googleapis.com/auth/earthengine",
            ],
        )

    # Fall back to gcloud user token (works after `gcloud auth login`)
    try:
        result = subprocess.run(
            ["gcloud", "auth", "print-access-token"],
            capture_output=True, text=True, check=True,
        )
        return Credentials(token=result.stdout.strip())
    except Exception:
        # No gcloud — use the credentials stored by `earthengine authenticate`.
        try:
            import ee
            return ee.data.get_persistent_credentials()
        except Exception:
            return None


def genai_client():
    """google-genai client on Vertex AI, authed with our EE-authenticated credentials
    (cloud-platform scope) so no separate gcloud ADC is required. No free-tier quota."""
    from google import genai
    return genai.Client(vertexai=True, project=GCP_PROJECT, location="global",
                        credentials=get_credentials())
