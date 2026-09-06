#!/usr/bin/env bash
# Shared package-manager detection for the dependency installer and build/test/lint gate.
# The standard package.json `packageManager` field is authoritative. A pnpm lockfile is a
# compatibility fallback for local gate execution, but CI installation requires an exact pnpm
# version so a generated workflow never silently changes toolchains.

readonly YAD_PACKAGE_JSON="package.json"
readonly YAD_PNPM_LOCKFILE="pnpm-lock.yaml"

yad_validate_exact_package_manager_spec() {
  local spec="$1"
  # The JavaScript is deliberately single-quoted so Bash cannot expand its template literals.
  # shellcheck disable=SC2016
  YAD_PACKAGE_MANAGER_SPEC="$spec" node --input-type=module -e '
    const spec = process.env.YAD_PACKAGE_MANAGER_SPEC;
    const at = spec.indexOf("@");
    const version = spec.slice(at + 1);
    const exactSemver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
    const match = exactSemver.exec(version);
    const invalidNumericPrerelease = match?.[4]?.split(".").some(
      identifier => /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0"),
    );
    if (!match || match[0] !== version || invalidNumericPrerelease) {
      process.stderr.write(`FAIL [package-manager]: packageManager ${JSON.stringify(spec)} must name an exact semantic version.\n`);
      process.exit(1);
    }
  '
}

yad_package_manager_spec() {
  if [ ! -f "$YAD_PACKAGE_JSON" ]; then
    echo "FAIL [package-manager]: package.json is missing." >&2
    return 1
  fi
  # The JavaScript is deliberately single-quoted so Bash cannot expand its template literals.
  # shellcheck disable=SC2016
  node --input-type=module -e '
    import fs from "node:fs";
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync("package.json", "utf8")); }
    catch { process.stderr.write("FAIL [package-manager]: package.json is not valid JSON.\n"); process.exit(1); }
    if (pkg.packageManager !== undefined && typeof pkg.packageManager !== "string") {
      process.stderr.write("FAIL [package-manager]: packageManager must be a string.\n"); process.exit(1);
    }
    if (pkg.packageManager && /[\r\n]/.test(pkg.packageManager)) {
      process.stderr.write(`FAIL [package-manager]: packageManager ${JSON.stringify(pkg.packageManager)} must name an exact semantic version.\n`);
      process.exit(1);
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
      yad_validate_exact_package_manager_spec "$spec" || return 1
      printf '%s\n' "npm"
      ;;
    pnpm@*)
      yad_validate_exact_package_manager_spec "$spec" || return 1
      printf '%s\n' "pnpm"
      ;;
    *)
      echo "FAIL [package-manager]: unsupported packageManager '$spec' (supported: npm, pnpm)." >&2
      return 1
      ;;
  esac
}
