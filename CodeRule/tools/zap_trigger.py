import requests
import json
import os

def trigger_zap(webhook_url, payload):
    """
    Sends a JSON payload to a Zapier Webhook.
    """
    headers = {'Content-Type': 'application/json'}
    try:
        response = requests.post(webhook_url, data=json.dumps(payload), headers=headers)
        response.raise_for_status()
        return f"Zap triggered successfully: {response.status_code}"
    except Exception as e:
        return f"Zap failed: {str(e)}"

if __name__ == "__main__":
    # Example usage: python tools/zap_trigger.py "https://hooks.zapier.com/..." '{"event": "deployment", "status": "success"}'
    import sys
    if len(sys.argv) > 2:
        url = sys.argv[1]
        data = json.loads(sys.argv[2])
        print(trigger_zap(url, data))
    else:
        print("Error: Missing Webhook URL or Payload.")