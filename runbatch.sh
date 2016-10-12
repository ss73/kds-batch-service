#!/bin/sh
now=$(date +"%T")
printf "Running batch at: $now "
printf "Status: " 
curl http://localhost:32700/run
echo ""
