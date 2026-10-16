"""Optional independent format check: python -m pip install vobject==0.9.9."""
import json
from pathlib import Path
import vobject
from fixture_runner import run


def main():
    fixtures = json.loads(Path(__file__).with_name("fixtures.json").read_text(encoding="utf-8"))["cases"]
    count = 0
    for case in fixtures:
        if "error" in case:
            continue
        result = run(case)
        cards = list(vobject.readComponents(result["content"]))
        assert len(cards) == case["count"], case["id"]
        for card in cards:
            assert card.validate(), case["id"]
            assert card.fn.value and card.n.value is not None, case["id"]
        count += len(cards)
    print(f"Independent vobject validation passed: {count} contact records")


if __name__ == "__main__":
    main()
