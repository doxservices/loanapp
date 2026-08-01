#!/bin/bash
set -euo pipefail

# Reset all stored data for a fresh start. This removes the data files so that default records will be recreated on the next setup.

cd "$(dirname "$0")/.."
rm -f storage/data/promotions.json \
      storage/data/applications.json \
      storage/data/users.json \
      storage/data/loans.json
echo "Data reset complete. Run scripts/setup.sh again to regenerate default records."