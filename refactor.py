import re

with open('/Users/anonymous-kun/Desktop/FlowZint-Final/backend/api/views.py', 'r') as f:
    content = f.read()

# 1. Imports
content = content.replace(
    "from google.genai import types",
    "from google.genai import types, errors"
)

# 2. Constants
content = content.replace(
    'GENERATIVE_MODEL = "gemini-2.5-flash"\n',
    'GENERATIVE_MODEL = "gemini-2.5-flash"\nFALLBACK_MODEL = "gemini-1.5-flash-8b"\n'
)

# 3. Helper Wrappers
wrappers = """
def safe_generate(client_instance, model_name, contents, config=None):
    try:
        return client_instance.models.generate_content(
            model=model_name,
            contents=contents,
            config=config
        )
    except errors.APIError as e:
        error_msg = str(e).lower()
        if getattr(e, 'code', None) == 429 or "429" in error_msg or "exhausted" in error_msg:
            print(f"Warning: Primary model ({model_name}) rate limited, cascading to fallback ({FALLBACK_MODEL})...")
            return client_instance.models.generate_content(
                model=FALLBACK_MODEL,
                contents=contents,
                config=config
            )
        raise

def safe_generate_stream(client_instance, model_name, contents, config=None):
    try:
        return client_instance.models.generate_content_stream(
            model=model_name,
            contents=contents,
            config=config
        )
    except errors.APIError as e:
        error_msg = str(e).lower()
        if getattr(e, 'code', None) == 429 or "429" in error_msg or "exhausted" in error_msg:
            print(f"Warning: Primary model ({model_name}) rate limited, cascading to fallback stream ({FALLBACK_MODEL})...")
            return client_instance.models.generate_content_stream(
                model=FALLBACK_MODEL,
                contents=contents,
                config=config
            )
        raise
"""

content = content.replace(
    "def refine_query(raw_query):",
    wrappers + "\ndef refine_query(raw_query):"
)

# 4. Refactor calls
# Replace `client.models.generate_content(` and `client.models.generate_content_stream(`
# Also we need to change `model=...` to `client_instance=client, model_name=...`
# Because `model=` is usually the first kwarg on the next line.

# For generate_content
content = re.sub(
    r"client\.models\.generate_content\(\s*model=(GENERATIVE_MODEL|VISION_MODEL),",
    r"safe_generate(\n                    client_instance=client,\n                    model_name=\1,",
    content
)

# For generate_content_stream
content = re.sub(
    r"client\.models\.generate_content_stream\(\s*model=(GENERATIVE_MODEL|VISION_MODEL),",
    r"safe_generate_stream(\n                    client_instance=client,\n                    model_name=\1,",
    content
)

with open('/Users/anonymous-kun/Desktop/FlowZint-Final/backend/api/views.py', 'w') as f:
    f.write(content)

print("Refactor complete.")
