import os

def check_vibe():
    # Scan for forbidden colors or non-protocol patterns
    violations = []
    for root, _, files in os.walk("src"):
        for file in files:
            if file.endswith((".css", ".js", ".html")):
                with open(os.path.join(root, file), 'r') as f:
                    content = f.read()
                    if "#0000FF" in content: # Standard blue instead of Electric Cyan
                        violations.append(f"{file}: Uses standard blue instead of #00E5FF")
    return violations if violations else "✅ Vibe is pure. Protocols followed."

print(check_vibe())