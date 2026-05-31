#!/usr/bin/env python3
import json
import os
import subprocess
import sys
import time


def result(ok, **kwargs):
    print(json.dumps({"ok": ok, **kwargs}, ensure_ascii=False))
    sys.exit(0 if ok else 1)


def run_tool(args, timeout=5):
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout)


def dump_a11y():
    env = {
        **os.environ,
        "QT_ACCESSIBILITY": "1",
        "QT_LINUX_ACCESSIBILITY_ALWAYS_ON": "1",
    }
    proc = subprocess.run(
        ["/opt/tools/a11y-dump", "--format", "json"],
        capture_output=True,
        text=True,
        timeout=10,
        env=env,
    )
    if proc.returncode != 0:
        return None
    try:
        return json.loads(proc.stdout)
    except Exception:
        return None


def walk(node):
    if isinstance(node, dict):
        yield node
        for child in node.get("children") or []:
            yield from walk(child)


def center(bounds):
    return (
        int(round(bounds["x"] + bounds["width"] / 2)),
        int(round(bounds["y"] + bounds["height"] / 2)),
    )


def find_search_box(tree):
    for node in walk(tree):
        if node.get("role") == "text" and node.get("name") == "Search" and node.get("bounds"):
            return node
    return None


def find_local_result(tree, query):
    query_lower = query.lower()
    candidates = []
    for node in walk(tree):
        if node.get("role") != "list-item" or not node.get("bounds"):
            continue
        name = node.get("name") or ""
        if not name:
            continue
        bounds = node["bounds"]
        # Search results are rendered under the search box, before the chat list.
        if bounds.get("x", 9999) > 430 or bounds.get("y", 9999) < 55:
            continue
        if query_lower in name.lower() or query in name:
            candidates.append(node)
    if candidates:
        return max(candidates, key=lambda n: n["bounds"].get("y", 0))
    return None


def main():
    if len(sys.argv) < 2:
        result(False, error="Usage: chat-search-open <display-name>")

    query = sys.argv[1].strip()
    if not query:
        result(False, error="display name is empty")

    tree = dump_a11y()
    if not tree:
        result(False, error="Unable to inspect WeChat UI")
    search = find_search_box(tree)
    if not search:
        result(False, error="Search box not found")

    x, y = center(search["bounds"])
    run_tool(["/opt/tools/click", str(x), str(y)])
    time.sleep(0.15)
    run_tool(["/opt/tools/key", "ctrl+a"])
    run_tool(["/opt/tools/input", query], timeout=10)
    time.sleep(0.8)

    tree = dump_a11y()
    if not tree:
        result(False, error="Unable to inspect search results")

    match = find_local_result(tree, query)
    if match:
        x, y = center(match["bounds"])
        run_tool(["/opt/tools/click", str(x), str(y)])
        time.sleep(0.8)
        result(True, query=query, clicked=True)

    # Some built-in chats, notably File Transfer, switch as soon as the query is
    # typed and do not expose a local result row in the accessibility tree.
    run_tool(["/opt/tools/key", "Escape"])
    time.sleep(0.3)
    result(True, query=query, clicked=False)


if __name__ == "__main__":
    main()
