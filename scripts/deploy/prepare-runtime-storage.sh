#!/bin/sh
set -eu

runtime_uid="${BIDWRIGHT_RUNTIME_UID:-1000}"
runtime_gid="${BIDWRIGHT_RUNTIME_GID:-1000}"
data_root="${DATA_DIR:-/data}"
agent_home_root="${AGENT_HOME_ROOT:-/data/agent-home}"

case "${runtime_uid}:${runtime_gid}" in
  *[!0-9:]* | :* | *:) echo "Runtime UID and GID must be numeric." >&2; exit 1 ;;
esac

prepare_root() {
  root="$1"
  marker="${root}/.bidwright-runtime-owner-${runtime_uid}-${runtime_gid}"
  mkdir -p "${root}"
  if [ ! -f "${marker}" ]; then
    echo "Preparing ${root} for Bidwright runtime ${runtime_uid}:${runtime_gid}..."
    find "${root}" -xdev -exec chown "${runtime_uid}:${runtime_gid}" {} +
    : > "${marker}"
  fi
  chown "${runtime_uid}:${runtime_gid}" "${root}" "${marker}"
}

prepare_root "${data_root}"
prepare_root "${agent_home_root}"
