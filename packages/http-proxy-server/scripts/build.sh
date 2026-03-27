#!/bin/bash

set -e

sed "s@{{VERCEL_URL}}@$VERCEL_URL@" templates/install > public/install
