#!/usr/bin/env bash
# Shared package-manager detection for the dependency installer and build/test/lint gate.
# The standard package.json `packageManager` field is authoritative. A pnpm lockfile is a
# compatibility fallback for local gate execution, but CI installation requires an exact pnpm
# version so a generated workflow never silently changes toolchains.

readonly YAD_PACKAGE_JSON="package.json"
readonly YAD_PNPM_LOCKFILE="pnpm-lock.yaml"
readonly YAD_NPM_LOCKFILE="package-lock.json"
readonly YAD_NPM_SHRINKWRAP="npm-shrinkwrap.json"

yad_validate_exact_package_manager_spec() {
  local spec="$1"
  # The JavaScript is deliberately single-quoted so Bash cannot expand its template literals.
  # shellcheck disable=SC2016
  YAD_PACKAGE_MANAGER_SPEC="$spec" node --input-type=module -e '
    const spec = process.env.YAD_PACKAGE_MANAGER_SPEC;
    const at = spec.indexOf("@");
    const version = spec.slice(at + 1);
    // The Corepack integrity suffix is `+<algorithm>.<hex digest>`: it hashes the download with the
    // named algorithm and compares the LOWERCASE hex string byte for byte. Every algorithm Corepack
    // has written or accepts is listed with its digest length; anything else is not a Corepack
    // suffix and fails closed.
    const COREPACK_DIGEST_HEX_LENGTH = { sha1: 40, sha224: 56, sha256: 64, sha384: 96, sha512: 128 };
    const exactSemver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
    const match = exactSemver.exec(version);
    const invalidNumericPrerelease = match?.[4]?.split(".").some(
      identifier => /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0"),
    );
    const isCorepackIntegrity = (build) => {
      const [algorithm, digest, ...rest] = build.split(".");
      const length = COREPACK_DIGEST_HEX_LENGTH[algorithm];
      return rest.length === 0 && length !== undefined && new RegExp(`^[0-9a-f]{${length}}$`).test(digest ?? "");
    };
    const invalidBuildMetadata = match?.[5] !== undefined && !isCorepackIntegrity(match[5]);
    if (!match || match[0] !== version || invalidNumericPrerelease || invalidBuildMetadata) {
      const algorithms = Object.keys(COREPACK_DIGEST_HEX_LENGTH).join("|");
      process.stderr.write(`FAIL [package-manager]: packageManager ${JSON.stringify(spec)} must name an exact semantic version, optionally followed by the Corepack integrity suffix +<${algorithms}>.<lowercase hex digest>.\n`);
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
      # No declaration: npm, exactly as before this field was read — UNLESS the repo carries a pnpm
      # lockfile and no npm one. A repo with both (a stale package-lock.json after a migration is
      # common) keeps the historical npm path rather than silently flipping toolchains.
      if [ -f "$YAD_PNPM_LOCKFILE" ] && [ ! -f "$YAD_NPM_LOCKFILE" ] && [ ! -f "$YAD_NPM_SHRINKWRAP" ]; then
        printf '%s\n' "pnpm"
      else
        printf '%s\n' "npm"
      fi
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
