# Algolia Category Helper

## The Problem

The Algolia Query Categorization dashboard displays category IDs as raw numeric or alphanumeric codes (e.g. `63`, `1024`, `electronics-5`). When you're reviewing how queries are being categorized, these IDs are meaningless without constantly cross-referencing your own data to figure out what each one represents.

This makes it difficult to:
- Quickly assess whether queries are being categorized correctly
- Spot miscategorized queries at a glance
- Share categorization results with non-technical stakeholders

## The Solution

This Chrome extension automatically replaces category IDs with their human-readable names directly on the dashboard. Instead of seeing `63`, you see `Tech & Audio (63)`. It looks up category names from your own Algolia index using a search-only API key, caches them locally, and applies them in real time as you navigate.

## Installation

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select this folder

## Setup

Click the extension icon in your toolbar to open the popup.

### Connection

| Field | Description |
|---|---|
| **Application ID** | Your Algolia application ID |
| **Search API Key** | A search-only API key (never use an admin key) |
| **Index Name** | The index containing your product/category data |

### Field Mapping

These fields tell the extension where to find category data in your index. Browse a record in your Algolia dashboard to identify the correct paths.

| Field | Description | Example |
|---|---|---|
| **Filter Field** | The attribute used to look up a category ID | `facets.categoryIds` |
| **Category Name Paths** | Comma-separated dot-notation paths to the human-readable name | `information.categories,information.categoriesHierarchy` |

See [FIELD_MAPPING_GUIDE.md](./FIELD_MAPPING_GUIDE.md) for examples of different data structures.

### Enable

Flip the **Enable on dashboard** toggle and click **Save**.

## Usage

1. Navigate to the **Query Categorization** page in your Algolia dashboard
2. Category IDs like `63` will automatically be replaced with labels like `Tech & Audio (63)`
3. The extension watches for page changes and re-applies labels as you navigate

Use the **Refresh Page** button in the popup to reload the dashboard tab.

## API Usage & Quota

This extension uses your **search-only API key** to look up category names. The impact on your Algolia quota is minimal:

- Each category ID is looked up **once** and then cached locally in your browser
- Subsequent page loads use the cache and make **zero API calls**
- A typical first visit fetches 20–50 IDs in 1–3 multi-query requests (each with `hitsPerPage: 1`)
- Requests are batched (20 per call) with rate limiting between batches
- A hard cap of **100 IDs per cycle** prevents runaway usage

In practice, the extension adds a handful of search operations on first use and essentially nothing after that.

## Troubleshooting

### No labels appearing

1. Check the extension is **enabled** (green dot in popup header)
2. Verify your **Algolia credentials** are correct
3. Confirm the **index name** matches your product index
4. Check **Filter Field** and **Category Name Paths** match your index structure
5. Try clicking **Refresh Page** in the popup to reload the dashboard

### Common API errors

| Status | Meaning |
|---|---|
| **403** | API key doesn't have search permission |
| **404** | Index name is incorrect |

### Labels not updating

Refresh the Algolia dashboard tab, or click **Refresh Page** in the popup.

## Security

- The API key is stored locally in `chrome.storage.local` and is never logged to the console
- All API calls are made over HTTPS directly to Algolia's servers
- Field paths are validated to prevent injection
- The extension only runs on `dashboard.algolia.com`
