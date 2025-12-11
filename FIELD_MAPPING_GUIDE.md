# Field Mapping Guide

## Overview

The Algolia Category Helper extension now supports **configurable field mapping**, making it work with different data structures across different customers.

## Default Configuration

By default, the extension is configured for this structure:

```json
{
  "information": {
    "categories": [
      { "id": "63", "name": "Tech & Audio" },
      { "id": "64", "name": "Home & Garden" }
    ],
    "categoriesHierarchy": [
      [
        { "id": "63", "name": "Tech & Audio" },
        { "id": "6331", "name": "Headphones" }
      ]
    ]
  },
  "facets": {
    "categoryIds": ["63", "6331", "64"]
  }
}
```

**Default settings:**
- **Filter field**: `facets.categoryIds`
- **Category name paths**: `information.categories,information.categoriesHierarchy`

## Custom Configurations

### Example 1: Simple Categories Array

If your data looks like:
```json
{
  "categories": [
    { "id": "cat_123", "name": "Electronics" }
  ],
  "category_ids": ["cat_123"]
}
```

**Configure:**
- **Filter field**: `category_ids`
- **Category name paths**: `categories`

### Example 2: Nested Category Object

If your data looks like:
```json
{
  "product": {
    "category": {
      "id": "cat_123",
      "name": "Electronics",
      "categoryId": "cat_123"
    }
  }
}
```

**Configure:**
- **Filter field**: `product.category.categoryId`
- **Category name paths**: `product.category`

### Example 3: Multiple Category Sources

If your data has categories in multiple places:
```json
{
  "primaryCategory": { "id": "cat_123", "name": "Electronics" },
  "allCategories": [
    { "id": "cat_123", "name": "Electronics" },
    { "id": "cat_456", "name": "Computers" }
  ],
  "categoryIds": ["cat_123", "cat_456"]
}
```

**Configure:**
- **Filter field**: `categoryIds`
- **Category name paths**: `primaryCategory,allCategories`

### Example 4: Flat Category Structure

If categories are stored as simple key-value pairs:
```json
{
  "category_id": "cat_123",
  "category_name": "Electronics"
}
```

**Configure:**
- **Filter field**: `category_id`
- **Category name paths**: `category_name`

## How It Works

### Filter Field
The **filter field** tells the extension where to search for the category ID in your Algolia index. This is used when querying the index to find products with a specific category ID.

- Supports **dot notation** for nested fields: `facets.categoryIds`
- Supports **multiple fields** (comma-separated): `categoryIds,facets.categoryIds`
- The extension will search: `WHERE categoryIds:"63" OR facets.categoryIds:"63"`

### Category Name Paths
The **category name paths** tell the extension where to look for the category name once it finds a matching product.

- Supports **dot notation** for nested fields: `information.categories`
- Supports **multiple paths** (comma-separated) - will try each in order
- Supports **arrays of objects** with `id` and `name` properties
- Supports **nested arrays** (like hierarchy structures)
- Supports **simple objects** with `id` and `name` properties
- Supports **plain string values**

## Testing Your Configuration

1. **Configure the extension** with your custom field mappings
2. **Save the configuration**
3. **Navigate to the Query Categorization page** in the Algolia dashboard
4. **Open browser console** (F12)
5. **Look for logs** from `[Algolia Category Helper][bg]`
   - Should see: "Fetching labels for X IDs in batches"
   - Should see: "Found X labels out of Y requested"
6. **Check for errors** - if no labels are found, adjust your paths

## Troubleshooting

### No labels are being found

1. **Check your index structure**:
   - Go to your Algolia dashboard
   - Browse a product record
   - Note the exact field paths where category IDs and names are stored

2. **Verify filter field**:
   - The filter field should be a **faceted attribute** or **searchable attribute**
   - Check your index configuration

3. **Check category name paths**:
   - Use exact dot notation paths
   - Match case-sensitive field names
   - Try one path at a time to isolate issues

### Labels found but not displaying

1. **Check browser console** for content script logs
2. **Verify the extension is enabled**
3. **Reload the Query Categorization page**

## Support for Different Data Structures

The extension now supports:
- ✅ Nested objects (using dot notation)
- ✅ Arrays of objects with id/name
- ✅ Nested arrays (hierarchy structures)
- ✅ Multiple search paths (tries each in order)
- ✅ Multiple filter fields (OR logic)
- ✅ Plain string values
- ✅ Mixed structures

## Manual Mappings Fallback

If automatic lookup doesn't work for certain categories, you can always add manual mappings:

1. **Export current mappings** from the popup
2. **Edit the JSON** to add missing mappings:
   ```json
   {
     "63": "Tech & Audio",
     "64": "Home & Garden",
     "custom_cat_123": "My Custom Category"
   }
   ```
3. **Import & merge** back into the extension
