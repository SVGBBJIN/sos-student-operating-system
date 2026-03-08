import os
import sys

def inject_feature(component_name, type="component"):
    # Lean logic: only handles the src/ directory
    path_map = {
        "component": "src/components",
        "lib": "src/lib",
        "style": "src/styles"
    }
    
    target_dir = path_map.get(type, "src/components")
    file_path = f"{target_dir}/{component_name.lower()}.js"
    
    if os.path.exists(file_path):
        return f"⚠️ Warning: {component_name} already exists. Use Claude to refactor instead."
    
    with open(file_path, "w") as f:
        f.write(f"// Feature: {component_name}\n// Protocol: Follow architecture.md")
        
    return f"✅ Injected {component_name} into {target_dir}. Ready for logic."

if __name__ == "__main__":
    # python tools/feature_injector.py "Navbar" "component"
    print(inject_feature(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "component"))
