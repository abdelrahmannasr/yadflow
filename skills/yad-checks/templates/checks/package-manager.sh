#!/usr/bin/env bash
# Shared package-manager detection for the dependency installer and build/test/lint gate.
# The standard package.json `packageManager` field is authoritative. A pnpm lockfile is a
# compatibility fallback for local gate execution, but CI installation requires an exact pnpm
# version so a generated workflow never silently changes toolchains.

readonly YAD_PACKAGE_JSON="package.json"
readonly YAD_PNPM_LOCKFILE="pnpm-lock.yaml"

yad_package_manager_spec() {
  if [ ! -f "$YAD_PACKAGE_JSON" ]; then
    echo "FAIL [package-manager]: package.json is missing." >&2
    return 1
  fi
  node --input-type=module -e '
    import fs from "node:fs";
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync("package.json", "utf8")); }
    catch { process.stderr.write("FAIL [package-manager]: package.json is not valid JSON.\n"); process.exit(1); }
    if (pkg.packageManager !== undefined && typeof pkg.packageManager !== "string") {
      process.stderr.write("FAIL [package-manager]: packageManager must be a string.\n"); process.exit(1);
    }
    process.stdout.write(pkg.packageManager || "");
  '
}
yad_detect_package_manager() {
  local spec="${1-}"
  case "$spec" in
    "")
      if [ -f "$YAD_PNPM_LOCKFILE" ]; then printf '%s\n' "pnpm"; else printf '%s\n' "npm"; fi
      ;;
    npm@*)
      if [[ ! "$spec" =~ ^npm@[0-9][0-9A-Za-z.+_-]*$ ]]; then
        echo "FAIL [package-manager]: unsupported packageManager '$spec'." >&2
        return 1
      fi
      printf '%s\n' "npm"
      ;;
    pnpm@*)
      if [[ ! "$spec" =~ ^pnpm@[0-9][0-9A-Za-z.+_-]*$ ]]; then
        echo "FAIL [package-manager]: unsupported packageManager '$spec'." >&2
        return 1
      fi
      printf '%s\n' "pnpm"
      ;;
    *)
      echo "FAIL [package-manager]: unsupported packageManager '$spec' (supported: npm, pnpm)." >&2
      return 1
      ;;
  esac
}
