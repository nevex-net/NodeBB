#!/bin/bash
npx @openapitools/openapi-generator-cli generate -g typescript-angular   -i public/docs/openapi.yaml   -o package --additional-properties=npmName=@nevex-net/comments,npmVersion=1.0.0,ngVersion=20.3.16,providedIn=root
