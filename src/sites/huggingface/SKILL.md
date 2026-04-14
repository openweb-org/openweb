# Hugging Face

## Overview
AI model and dataset hub. Public REST API for searching and browsing ML models, datasets, and Spaces (demo apps).

## Workflows

### Find an ML model
1. `searchModels(search)` → `id` (owner/name format)
2. `getModel(owner, name)` → pipeline_tag, downloads, tags, cardData, siblings

### Explore datasets
1. `searchDatasets(search)` → `id` (owner/name format)
2. `getDataset(owner, name)` → cardData, description, citation, siblings

### Discover demo apps
1. `getSpaces(search)` → `id`, `sdk`, `runtime.stage`

### Research a model and its data
1. `searchModels(search)` → `id` (owner/name)
2. `getModel(owner, name)` → `cardData.datasets` (referenced dataset names)
3. `searchDatasets(search)` → find referenced dataset → `id`
4. `getDataset(owner, name)` → description, citation

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchModels | find ML models | search | id, author, downloads, pipeline_tag, tags | sortable by downloads/likes/trending |
| getModel | model details | owner, name <- searchModels | id, pipeline_tag, downloads, tags, cardData, siblings | includes file list and related Spaces |
| searchDatasets | find datasets | search | id, author, downloads, tags | sortable by downloads/likes/trending |
| getDataset | dataset details | owner, name <- searchDatasets | id, downloads, tags, cardData, description, citation | includes file list |
| getSpaces | browse demo apps | search | id, author, likes, sdk, runtime | sortable by likes/trending |

## Quick Start

```bash
# Search for models
openweb huggingface exec searchModels '{"search": "text-generation", "limit": 5}'

# Get model details
openweb huggingface exec getModel '{"owner": "meta-llama", "name": "Llama-2-7b"}'

# Search for datasets
openweb huggingface exec searchDatasets '{"search": "sentiment", "limit": 5}'

# Get dataset details
openweb huggingface exec getDataset '{"owner": "stanfordnlp", "name": "imdb"}'

# Browse Spaces
openweb huggingface exec getSpaces '{"search": "chatbot", "limit": 5}'
```
