#!/bin/bash
set -e

echo "Setting up DUNE_LAB_TOKEN secret for orezende/enxoval"
echo ""
read -s -p "Paste your DUNE_LAB_TOKEN (input hidden): " TOKEN
echo ""

if [ -z "$TOKEN" ]; then
  echo "Error: token cannot be empty"
  exit 1
fi

gh secret set DUNE_LAB_TOKEN --repo orezende/enxoval --body "$TOKEN"
echo "Done. DUNE_LAB_TOKEN set successfully."
