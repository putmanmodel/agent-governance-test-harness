# Reproduce the H3 and H4 Gateway qualifications

Run from the Harness root with Git, Node 24 or newer, npm and Python with venv. Use new directories outside either checkout. The demonstrated public release-source run used macOS arm64, Node 24.14.1, npm 11.11.0, Python 3.14.6 and SQLite 3.51.2. It loaded the tagged repository source. Installation of the published npm tarball is a separate target.

```sh
set -eu
npm ci
WORK=$(mktemp -d)
export RC2_ROOT="$WORK/kingpin" CDE_PYTHON="$WORK/venv/bin/python" OUT="$WORK/artifacts"
git clone --single-branch --branch v0.1.0-rc.4 https://github.com/putmanmodel/agent-tool-governance-gateway.git "$RC2_ROOT"
test "$(git -C "$RC2_ROOT" cat-file -t v0.1.0-rc.4)" = tag
test "$(git -C "$RC2_ROOT" rev-parse HEAD)" = eb323c17938c828372bef5faad82e1343efad911
npm --prefix "$RC2_ROOT/gateway_node" ci
python3 -m venv "$WORK/venv"
"$CDE_PYTHON" -m pip install -r "$RC2_ROOT/requirements.txt" -r "$RC2_ROOT/requirements_gateway.txt"
mkdir "$OUT"
for suite in h3-memory h3-sqlite h4-sqlite; do
  node src/harness-main.ts run --runtime kingpin-rc2-gateway --suite "$suite" --artifact-dir "$OUT" --json > "$OUT/$suite.json"
done
```

Read all eight result rows. Memory CR-01/02 and SQLite CR-01/02 must each PASS. H4 SQLite CR-04/05/06 must each PASS and CR-03 must report UNSUPPORTED. Keep generated reports and JSONL private pending provenance review.

The guard selects the expected diff and digest by exact HEAD and checks package identity, clean checkout, inventoried sources and installed Gateway dependencies. The public profile measured 469 entries with SHA-256 `4e503cfc769f098c727c373801655f706d605e8293c01220fdb4798e4af6de96`. Each run checks target provenance again after execution. The inventory covers selected file types and roots. Python distributions are recorded separately and the requirements allow version variation, including Pydantic. The measured environment used Pydantic 2.14.3.

## Retained evidence

The implementation and tests come from AGTH reproduction checkpoint `dfd1da3a18ffe5b641e778655d02f17ae6e09c06`. The disclosure manifest identifies the actual recorded Harness HEAD and dirty status for each run. Historical runs used qualification target `11ad113d083e3afa5349a979d010bc82e8432153`. Public-release runs used the annotated tag above. Each retained JSONL in these two collections is a disclosure derivative with four host paths replaced. Original and derivative byte hashes are recorded separately. Offline checks validate recorded observations. Live reproduction exercises the target again.

```sh
node scripts/verify-h3-h4-disclosure.mjs
node --test tests/rotation-target.test.ts tests/h3-memory.test.ts tests/h3-sqlite.test.ts tests/h4-contraction.test.ts
```
