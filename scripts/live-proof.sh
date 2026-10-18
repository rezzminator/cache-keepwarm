#!/usr/bin/env bash
set -euo pipefail
exec python3 -I -B "$(dirname "$0")/live-proof.py" "$@"
