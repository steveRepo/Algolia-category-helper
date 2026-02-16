# Field Mapping Guide

## Overview

The extension needs two pieces of information to map category IDs to names:

1. **Filter Field** -- which attribute in your index contains the category ID
2. **Category Name Paths** -- where to find the human-readable name once a matching record is found

Browse a record in your Algolia dashboard to identify the correct paths for your data.

## Examples

### Simple categories array

```json
{
  "categories": [
    { "id": "cat_123", "name": "Electronics" }
  ],
  "category_ids": ["cat_123"]
}
```

- **Filter Field**: `category_ids`
- **Category Name Paths**: `categories`

### Nested category object

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

- **Filter Field**: `product.category.categoryId`
- **Category Name Paths**: `product.category`

### Multiple category sources

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

- **Filter Field**: `categoryIds`
- **Category Name Paths**: `primaryCategory,allCategories`

### Flat key-value structure

```json
{
  "category_id": "cat_123",
  "category_name": "Electronics"
}
```

- **Filter Field**: `category_id`
- **Category Name Paths**: `category_name`

### Hierarchy with nested arrays

```json
{
  "information": {
    "categories": [
      { "id": "63", "name": "Tech & Audio" }
    ],
    "categoriesHierarchy": [
      [
        { "id": "63", "name": "Tech & Audio" },
        { "id": "6331", "name": "Headphones" }
      ]
    ]
  },
  "facets": {
    "categoryIds": ["63", "6331"]
  }
}
```

- **Filter Field**: `facets.categoryIds`
- **Category Name Paths**: `information.categories,information.categoriesHierarchy`

## How the fields work

### Filter Field

Tells the extension which attribute to query when looking up a category ID.

- Supports **dot notation** for nested fields: `facets.categoryIds`
- Supports **multiple fields** (comma-separated): `categoryIds,facets.categoryIds`
- Multiple fields use OR logic: `WHERE categoryIds:"63" OR facets.categoryIds:"63"`
- Must be a **faceted** or **searchable** attribute in your index settings

### Category Name Paths

Tells the extension where to extract the label from the returned record.

- Supports **dot notation**: `information.categories`
- Supports **multiple paths** (comma-separated) -- tries each in order until a match is found
- Handles **arrays of objects** with `id` and `name` properties
- Handles **nested arrays** (hierarchy structures)
- Handles **simple objects** with `id` and `name`
- Handles **plain string values**

## Troubleshooting

### No labels found

1. Go to your Algolia dashboard and browse a product record
2. Note the exact field paths where category IDs and names are stored
3. Update **Filter Field** and **Category Name Paths** in the extension
4. Field names are case-sensitive

### Filter field not working

- The attribute must be configured as a **facet** or **filter** in your index settings
- Check your index configuration under **Configuration > Filtering and Faceting**
