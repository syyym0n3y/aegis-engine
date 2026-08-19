#!/bin/bash
set -e
psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
  "alter role authenticator with login password '${POSTGRES_PASSWORD}';"
