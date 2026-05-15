# Image Preview And Download Confirmation Design

## Goal

On the public product display page, users can tap a product image to view it full screen. Users can long-press a product image to open a styled confirmation prompt before downloading the image locally.

## Scope

This change is limited to `index.html`. It does not change the admin page, product data format, or image upload flow.

## Current Context

The product display page is a static HTML file. JavaScript loads `products.json`, renders cards into `#productsGrid`, handles image retry fallback, and already has mobile pull-to-refresh. Product images are rendered as `.product-image` elements with the original URL stored in `data-original`.

## User Interaction

Single tap or click on a product image opens a full-screen preview overlay.

The preview overlay uses the current black and gold visual language. The image is centered, constrained to the viewport, and can be closed by tapping the backdrop or close button.

Long-pressing a product image for about 600 ms opens a confirmation dialog instead of opening the preview. The dialog asks whether to download the image and provides Cancel and Download actions.

If the pointer or touch moves meaningfully before the long-press threshold, the long-press is cancelled so normal scrolling still works on mobile.

## Download Behavior

The Download action creates an anchor with `download` and points it at the product image URL. For remote images where browser cross-origin rules prevent a direct file download, the page falls back to opening the image URL in a new tab so the user can save it manually.

Downloaded filenames should prefer the product name when available, with unsafe filename characters removed.

## UI Design

The full-screen preview uses a fixed overlay with a dark translucent backdrop and a high z-index above the existing pull-to-refresh indicator.

The confirmation dialog uses the existing page tokens: dark panel background, subtle gold border, gold primary action, restrained secondary action, and compact Chinese copy.

The dialog should be usable on both desktop and mobile, with buttons large enough for touch.

## Error Handling

If the image URL is missing or currently using the placeholder fallback, the download confirmation should not open.

If download setup fails, the page opens the image in a new tab as a fallback.

## Testing

Add focused front-end behavior coverage for:

- rendering products with image interaction metadata
- single click opening the preview overlay
- long-press opening the download confirmation instead of the preview
- confirming download invoking the download path
- cancelling or moving before the threshold preventing the long-press action

