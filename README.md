# Algolia Category Helper

A Chrome extension that automatically maps category IDs to human-readable names on the Algolia Query Categorization dashboard.

## Features

✅ **Automatic Category Mapping**: Queries your Algolia index to find category names
✅ **Configurable Field Mapping**: Works with different data structures
✅ **Manual Mappings**: Import/export category mappings as JSON
✅ **Batched API Requests**: Handles large numbers of categories efficiently
✅ **Real-time Updates**: Watches for DOM changes and updates labels automatically
✅ **Smart Retry Logic**: Handles slow-loading React SPAs with periodic retries

## Quick Start

1. **Install the extension** (load unpacked in Chrome)
2. **Click the extension icon** to open settings
3. **Configure your Algolia credentials**:
   - Application ID
   - Search API Key (search-only, not admin key)
   - Index name (your products index)
4. **Enable the extension**
5. **Navigate to Query Categorization** in your Algolia dashboard
6. **Watch category IDs transform into names!**

## Configuration

### Basic Settings
- **Application ID**: Your Algolia app ID
- **Search API Key**: A search-only API key
- **Index Name**: The name of your products index
- **Enable**: Toggle the extension on/off

### Advanced Field Mapping

The extension supports different data structures. Configure these fields if your data doesn't match the default structure:

- **Filter Field**: Where to search for category IDs
  - Default: `facets.categoryIds`
  - Example custom: `category_id` or `product.categories`

- **Category Name Paths**: Where to find category names
  - Default: `information.categories,information.categoriesHierarchy`
  - Example custom: `category_name` or `product.category.name`

See [FIELD_MAPPING_GUIDE.md](./FIELD_MAPPING_GUIDE.md) for detailed examples.

## How It Works

1. **Content Script** detects category IDs on the Query Categorization page
2. **Background Script** queries your Algolia index to find matching products
3. **Label Extraction** finds the category name using configured field paths
4. **DOM Update** replaces IDs with names like: `Tech & Audio (63)`

## Supported Data Structures

The extension supports:
- Nested objects with dot notation (`information.categories`)
- Arrays of objects with `id` and `name` properties
- Nested arrays (category hierarchies)
- Multiple search paths (tries each in order)
- Multiple filter fields (OR logic)
- Plain string values

## Manual Mappings

If automatic lookup doesn't work for certain categories:

1. Click **Export** to see current mappings
2. Edit the JSON to add missing categories
3. Click **Import & merge** to save

Example:
```json
{
  "63": "Tech & Audio",
  "64": "Home & Garden",
  "6331": "Headphones"
}
```

## Browser Console Logs

Enable detailed logging by opening the browser console (F12):

**Content Script logs** (`[Algolia Category Helper][cs]`):
- Category IDs found on the page
- Where they were found (tree, span, hierarchy)
- Retry attempts

**Background Script logs** (`[Algolia Category Helper][bg]`):
- Batch processing progress
- Number of labels found
- API errors

## Troubleshooting

### No labels appearing

1. ✅ Check that the extension is **enabled**
2. ✅ Verify your **Algolia credentials** are correct
3. ✅ Confirm your **index name** is correct
4. ✅ Check **browser console** for error messages

### Wrong field structure

1. ✅ Browse a product in your Algolia dashboard
2. ✅ Note the exact field paths for category IDs and names
3. ✅ Update **Advanced Field Mapping** settings
4. ✅ See [FIELD_MAPPING_GUIDE.md](./FIELD_MAPPING_GUIDE.md) for examples

### API errors

- **400 error**: Too many IDs at once (fixed with batching)
- **403 error**: API key doesn't have search permission
- **404 error**: Index name is incorrect

## Files

- `manifest.json` - Extension manifest
- `popup.html/js` - Extension popup UI
- `options.html/js` - Options page
- `contentScript.js` - Runs on Algolia dashboard pages
- `background.js` - Background service worker for API calls
- `FIELD_MAPPING_GUIDE.md` - Detailed field mapping examples
- `IMPROVEMENTS.md` - Recent improvements and enhancements

## Recent Updates

See [IMPROVEMENTS.md](./IMPROVEMENTS.md) for:
- Enhanced UI/UX with robust config saving
- Configurable field mapping for different data structures
- Batched API requests for large category lists
- Auto-retry mechanism for slow-loading pages
- Better error handling and validation

## License

MIT License - feel free to modify and distribute
