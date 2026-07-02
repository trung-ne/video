# Create SVG Assets for Cat Explainer Video
# Uses manually curated open-source SVG libraries

$baseDir = "C:\Users\Administrator\Documents\video\public\assets"

# SVG content for each asset type (using free/open libraries)
# These are minimal SVG templates that can be customized
$assetTemplates = @{
    "bank" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#2c3e50" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M21 10c0-.7-.57-1.2-1.25-1.2h-.5V6c0-.6-.4-1-1-1H4c-.6 0-1 .4-1 1v2.8h-.75C2.56 8.8 2 9.3 2 10v8c0 .7.56 1.2 1.25 1.2H21c.69 0 1.25-.5 1.25-1.2v-8z"/>
  <line x1="2" y1="12" x2="22" y2="12"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#34495e" stroke-width="2">
  <path d="M12 2L22 6V18L12 22L2 18V6L12 2Z"/>
  <path d="M12 2V22" opacity="0.3"/>
  <line x1="12" y1="12" x2="22" y2="16"/>
  <line x1="12" y1="12" x2="2" y2="16"/>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#e74c3c" opacity="0.85">
  <path d="M3 8c1.5-1 3-1.5 4.5-1.5s3 .5 4.5 1.5" fill="none" stroke="#c0392b" stroke-width="1.5"/>
  <rect x="3" y="7" width="18" height="10" rx="1.5" fill="#e74c3c" stroke="#c0392b" stroke-width="1.5"/>
  <line x1="5" y1="12" x2="19" y2="12" stroke="#fff" stroke-width="1"/>
  <circle cx="7" cy="12" r="1" fill="#fff"/>
  <circle cx="17" cy="12" r="1" fill="#fff"/>
</svg>
"@
    }
    "money" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#27ae60" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="8"/>
  <line x1="12" y1="6" x2="12" y2="18"/>
  <line x1="8" y1="10" x2="16" y2="10"/>
  <line x1="8" y1="14" x2="16" y2="14"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="8" fill="#27ae60" opacity="0.9"/>
  <circle cx="12" cy="12" r="8" fill="none" stroke="#16a34a" stroke-width="1.5"/>
  <text x="12" y="16" font-size="8" fill="#fff" text-anchor="middle" font-weight="bold">$$</text>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#27ae60" opacity="0.8">
  <circle cx="12" cy="12" r="8" fill="none" stroke="#16a34a" stroke-width="2"/>
  <path d="M12 9c-1.5 0-2 1-2 1.5s.5 1 2 1s2 1 2 1.5s-1 2-2 2" fill="none" stroke="#16a34a" stroke-width="1.5" stroke-linecap="round"/>
</svg>
"@
    }
    "house" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#e67e22" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 10L12 3L21 10V20C21 21.1 20.1 22 19 22H5C3.9 22 3 21.1 3 20Z"/>
  <polyline points="9 22 9 12 15 12 15 22"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#f39c12" stroke="#d68910" stroke-width="1.5">
  <polygon points="12,2 22,8 20,20 4,20 2,8"/>
  <line x1="12" y1="2" x2="12" y2="20"/>
  <rect x="8" y="10" width="3" height="3" fill="#d68910"/>
  <rect x="13" y="10" width="3" height="3" fill="#d68910"/>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#e67e22" stroke-width="2">
  <path d="M3 12l9-8 9 8v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
  <rect x="9" y="12" width="6" height="7" fill="#e67e22" opacity="0.3"/>
  <path d="M10 15v4M14 15v4" stroke="#e67e22" stroke-width="1.5"/>
</svg>
"@
    }
    "stock" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#9b59b6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <line x1="3" y1="3" x2="3" y2="21"/>
  <line x1="21" y1="21" x2="3" y2="21"/>
  <polyline points="5 18 8 14 11 16 15 10 19 14"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <rect x="2" y="2" width="20" height="18" fill="none" stroke="#8e44ad" stroke-width="2"/>
  <line x1="2" y1="20" x2="22" y2="20" stroke="#8e44ad" stroke-width="1.5"/>
  <rect x="4" y="13" width="2" height="7" fill="#8e44ad" opacity="0.7"/>
  <rect x="8" y="9" width="2" height="11" fill="#8e44ad" opacity="0.7"/>
  <rect x="12" y="5" width="2" height="15" fill="#8e44ad" opacity="0.7"/>
  <rect x="16" y="10" width="2" height="10" fill="#8e44ad" opacity="0.7"/>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#9b59b6" stroke-width="2">
  <line x1="3" y1="22" x2="3" y2="3"/>
  <line x1="3" y1="22" x2="21" y2="22"/>
  <path d="M5 17l3-4 2 2 5-6 3 4" stroke="#9b59b6" stroke-width="2" stroke-linecap="round"/>
</svg>
"@
    }
    "chart_up" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="23 6 13.5 15.5 8.5 10.5 1 17"/>
  <polyline points="17 6 23 6 23 12"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#15803d" stroke-width="2">
  <line x1="3" y1="20" x2="3" y2="3"/>
  <line x1="21" y1="20" x2="3" y2="20"/>
  <polyline points="5 15 9 11 13 14 19 8"/>
  <polyline points="15 8 19 8 19 12"/>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2">
  <path d="M3 21l18-18M21 3v7h-7" stroke="#16a34a" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
"@
    }
    "chart_down" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/>
  <polyline points="17 18 23 18 23 12"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#b91c1c" stroke-width="2">
  <line x1="3" y1="3" x2="3" y2="20"/>
  <line x1="21" y1="3" x2="3" y2="3"/>
  <polyline points="5 9 9 5 13 8 19 2"/>
  <polyline points="15 2 19 2 19 6"/>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2">
  <path d="M21 3l-18 18M3 3v7h7" stroke="#dc2626" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
"@
    }
    "interest_rate" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="10"/>
  <path d="M12 6V12L16 14"/>
  <path d="M10 8h4"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="9" fill="none" stroke="#2563eb" stroke-width="2"/>
  <text x="12" y="15" font-size="10" fill="#2563eb" text-anchor="middle" font-weight="bold">%</text>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2">
  <circle cx="12" cy="12" r="10"/>
  <path d="M9 8h6M9 16h6" stroke="#3b82f6" stroke-width="1.5" stroke-linecap="round"/>
</svg>
"@
    }
    "inflation" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="23 6 13.5 15.5 8.5 10.5 1 17"/>
  <polyline points="17 6 23 6 23 12"/>
  <path d="M12 2v20" opacity="0.3"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2">
  <path d="M12 2v20M2 12h20" stroke="#d97706" stroke-opacity="0.3"/>
  <polyline points="6 16 12 10 18 14"/>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2">
  <path d="M12 2v20M3 12h18" stroke="#f59e0b" stroke-opacity="0.4"/>
  <polyline points="4 18 12 10 20 16" stroke="#f59e0b" stroke-width="2"/>
</svg>
"@
    }
    "savings" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M19 5H5C3.9 5 3 5.9 3 7V17C3 18.1 3.9 19 5 19H19C20.1 19 21 18.1 21 17V7C21 5.9 20.1 5 19 5Z"/>
  <line x1="5" y1="9" x2="19" y2="9"/>
  <circle cx="12" cy="14" r="2"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0891b2" stroke-width="2">
  <path d="M6 8l6-3l6 3v10H6z" fill="#06b6d4" opacity="0.2"/>
  <path d="M6 8l6-3l6 3v10H6z" fill="none" stroke="#0891b2" stroke-width="2"/>
  <line x1="12" y1="5" x2="12" y2="18"/>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#06b6d4" opacity="0.7">
  <path d="M5 8c0-1 1-2 2-2h10c1 0 2 1 2 2v8c0 1-1 2-2 2H7c-1 0-2-1-2-2z" fill="none" stroke="#0891b2" stroke-width="2"/>
  <circle cx="12" cy="13" r="2.5" fill="#0891b2"/>
  <line x1="8" y1="8" x2="16" y2="8" stroke="#0891b2" stroke-width="1"/>
</svg>
"@
    }
    "loan" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#ec4899" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <rect x="1" y="4" width="22" height="13" rx="2" ry="2"/>
  <line x1="1" y1="9" x2="23" y2="9"/>
  <circle cx="4" cy="17" r="1.5"/>
  <circle cx="8" cy="17" r="1.5"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#ec4899" opacity="0.8">
  <rect x="2" y="5" width="20" height="12" rx="2" fill="#ec4899"/>
  <rect x="2" y="5" width="20" height="12" rx="2" fill="none" stroke="#be185d" stroke-width="1.5"/>
  <rect x="3" y="13" width="18" height="2" fill="#be185d" opacity="0.3"/>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#ec4899" stroke-width="2">
  <rect x="1" y="4" width="22" height="13" rx="2" ry="2"/>
  <line x1="1" y1="10" x2="23" y2="10"/>
  <line x1="5" y1="14" x2="8" y2="14"/>
  <line x1="10" y1="14" x2="13" y2="14"/>
</svg>
"@
    }
    "investment" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="10"/>
  <path d="M12 6V12L16 14"/>
  <polyline points="12 6 8 10"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="9" fill="#8b5cf6" opacity="0.2" stroke="#7c3aed" stroke-width="2"/>
  <path d="M12 6l4 2v4l-4 2l-4-2V8z" fill="#7c3aed"/>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2">
  <circle cx="12" cy="12" r="10"/>
  <path d="M12 8v8M8 12h8" stroke="#8b5cf6" stroke-linecap="round"/>
</svg>
"@
    }
    "profit" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="23 6 13.5 15.5 8.5 10.5 1 17"/>
  <polyline points="17 6 23 6 23 12"/>
  <path d="M12 12h6" stroke="#059669" opacity="0.5"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#047857" stroke-width="2">
  <polyline points="4 18 8 14 12 17 20 9"/>
  <polyline points="20 9 16 9 16 13"/>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2.5">
  <path d="M3 21l18-18M21 3v8h-8" stroke="#059669" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
"@
    }
    "loss" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/>
  <polyline points="17 18 23 18 23 12"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#991b1b" stroke-width="2">
  <polyline points="4 6 8 10 12 7 20 15"/>
  <polyline points="20 15 16 15 16 11"/>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5">
  <path d="M21 3l-18 18M3 3v8h8" stroke="#dc2626" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
"@
    }
    "trending_up" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="23 6 13.5 15.5 8.5 10.5 1 17"/>
  <polyline points="17 6 23 6 23 12"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2">
  <line x1="3" y1="20" x2="3" y2="3"/>
  <line x1="21" y1="20" x2="3" y2="20"/>
  <polyline points="5 15 9 11 13 14 19 8"/>
  <polyline points="15 8 19 8 19 12"/>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2">
  <path d="M3 21l18-18M21 3v8h-8" stroke="#10b981" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
"@
    }
    "trending_down" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/>
  <polyline points="17 18 23 18 23 12"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2">
  <line x1="3" y1="3" x2="3" y2="20"/>
  <line x1="21" y1="3" x2="3" y2="3"/>
  <polyline points="5 9 9 5 13 8 19 2"/>
  <polyline points="15 2 19 2 19 6"/>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2">
  <path d="M21 3l-18 18M3 3v8h8" stroke="#ef4444" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
"@
    }
    "wallet" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0891b2" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M17 3H7C5.9 3 5 3.9 5 5V19C5 20.1 5.9 21 7 21H17C18.1 21 19 20.1 19 19V5C19 3.9 18.1 3 17 3Z"/>
  <path d="M19 7H3V19"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#0891b2" opacity="0.8">
  <path d="M6 5l8-3 8 3v12H6z" fill="#0891b2" stroke="#067a7a" stroke-width="1.5"/>
  <circle cx="14" cy="12" r="2" fill="#fff"/>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0891b2" stroke-width="2">
  <path d="M5 5h14v14H5z" stroke="#0891b2" stroke-linecap="round"/>
  <circle cx="12" cy="12" r="2" fill="#0891b2"/>
</svg>
"@
    }
    "credit_card" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <rect x="1" y="4" width="22" height="13" rx="2" ry="2"/>
  <line x1="1" y1="9" x2="23" y2="9"/>
  <line x1="1" y1="15" x2="8" y2="15"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#f97316" opacity="0.85">
  <rect x="2" y="6" width="20" height="11" rx="2" fill="#f97316" stroke="#ea580c" stroke-width="1.5"/>
  <rect x="2" y="6" width="20" height="3" fill="#ea580c" opacity="0.3"/>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2">
  <rect x="1" y="5" width="22" height="12" rx="2"/>
  <line x1="1" y1="10" x2="23" y2="10"/>
  <circle cx="5" cy="15" r="1.5"/>
</svg>
"@
    }
    "piggy_bank" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#f472b6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M10 3C8.9 3 8 3.9 8 5V11C8 12.1 8.9 13 10 13H16C17.1 13 18 12.1 18 11V5C18 3.9 17.1 3 16 3"/>
  <line x1="11" y1="1" x2="11" y2="4"/>
  <line x1="13" y1="2" x2="13" y2="4"/>
  <line x1="15" y1="1" x2="15" y2="4"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#f472b6" opacity="0.8">
  <ellipse cx="12" cy="10" rx="7" ry="6" fill="#f472b6" stroke="#ec4899" stroke-width="1.5"/>
  <line x1="12" y1="4" x2="12" y2="2"/>
  <circle cx="12" cy="16" r="2" fill="#ec4899"/>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#f472b6" stroke-width="2">
  <circle cx="12" cy="11" r="7"/>
  <line x1="12" y1="2" x2="12" y2="6"/>
  <circle cx="12" cy="18" r="1.5" fill="#f472b6"/>
</svg>
"@
    }
    "tax" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="10"/>
  <path d="M10 8h4M10 16h4"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="9" fill="none" stroke="#4f46e5" stroke-width="2"/>
  <path d="M9 11h6M9 13h6" stroke="#4f46e5" stroke-width="2" stroke-linecap="round"/>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2">
  <circle cx="12" cy="12" r="10"/>
  <path d="M9 10h6M9 14h6" stroke="#6366f1" stroke-linecap="round"/>
</svg>
"@
    }
    "dividend" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="8" cy="12" r="3"/>
  <circle cx="16" cy="12" r="3"/>
  <polyline points="2 12 5 12 7 12"/>
  <polyline points="17 12 19 12 22 12"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0d9488" stroke-width="2">
  <circle cx="8" cy="12" r="2.5" fill="#14b8a6"/>
  <circle cx="16" cy="12" r="2.5" fill="#14b8a6"/>
  <line x1="2" y1="12" x2="5.5" y2="12"/>
  <line x1="18.5" y1="12" x2="22" y2="12"/>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" stroke-width="2">
  <circle cx="7" cy="12" r="3"/>
  <circle cx="17" cy="12" r="3"/>
  <line x1="2" y1="12" x2="4" y2="12"/>
  <line x1="20" y1="12" x2="22" y2="12"/>
</svg>
"@
    }
    "person" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1f2937" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
  <circle cx="12" cy="7" r="4"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#1f2937" opacity="0.8">
  <circle cx="12" cy="8" r="4" fill="#1f2937"/>
  <path d="M6 20h12a2 2 0 0 1-2-2v-2a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v2a2 2 0 0 1-2 2" fill="#1f2937"/>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1f2937" stroke-width="2">
  <circle cx="12" cy="8" r="3.5"/>
  <path d="M5 20c0-3 3-5 7-5s7 2 7 5"/>
</svg>
"@
    }
    "family" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M9 18c-1.5-2-3-4-3-7 0-2.5 2-4.5 4-4.5s4 2 4 4.5c0 3-1.5 5-3 7"/>
  <circle cx="9" cy="6" r="2"/>
  <path d="M15 18c-1-2-2-4-2-7 0-2.5 1.5-4.5 3-4.5s3 2 3 4.5c0 3-1 5-2 7"/>
  <circle cx="16" cy="6" r="2"/>
  <circle cx="12" cy="5" r="2.5"/>
  <path d="M12 18c-1-2-2-4-2-7 0-3 2-5 2-5s2 2 2 5c0 3-1 5-2 7"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#4b5563" stroke-width="2">
  <circle cx="6" cy="6" r="2"/>
  <path d="M6 8v10"/>
  <circle cx="12" cy="5" r="2.5"/>
  <path d="M12 7.5v10.5"/>
  <circle cx="18" cy="6" r="2"/>
  <path d="M18 8v10"/>
  <path d="M3 18h18" stroke="#4b5563" stroke-width="1.5"/>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2">
  <circle cx="6" cy="6" r="2"/>
  <circle cx="12" cy="5" r="2.5"/>
  <circle cx="18" cy="6" r="2"/>
  <path d="M6 8v10M12 7.5v10.5M18 8v10"/>
</svg>
"@
    }
    "company" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#4b5563" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <rect x="2" y="3" width="20" height="14" rx="2"/>
  <line x1="2" y1="9" x2="22" y2="9"/>
  <line x1="9" y1="3" x2="9" y2="17"/>
  <line x1="15" y1="3" x2="15" y2="17"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#374151" stroke-width="2">
  <path d="M3 4l9-2l9 2v12H3z" fill="#4b5563" opacity="0.2" stroke="#374151"/>
  <line x1="3" y1="10" x2="21" y2="10"/>
  <line x1="9" y1="4" x2="9" y2="16"/>
  <line x1="15" y1="4" x2="15" y2="16"/>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#4b5563" stroke-width="2">
  <rect x="2" y="3" width="20" height="14" rx="2"/>
  <line x1="2" y1="9" x2="22" y2="9"/>
  <line x1="8" y1="3" x2="8" y2="17"/>
  <line x1="14" y1="3" x2="14" y2="17"/>
</svg>
"@
    }
    "worker" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#2d3748" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
  <circle cx="12" cy="7" r="4"/>
  <path d="M12 12h4v4h-4z"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#2d3748" opacity="0.8">
  <circle cx="12" cy="7" r="4"/>
  <rect x="9" y="12" width="6" height="6" fill="#2d3748"/>
  <path d="M8 18v2h8v-2" fill="#2d3748"/>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#2d3748" stroke-width="2">
  <circle cx="12" cy="7" r="3.5"/>
  <rect x="9" y="12" width="6" height="5" rx="1"/>
  <line x1="9" y1="17" x2="15" y2="17"/>
</svg>
"@
    }
    "customer" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#2d3748" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="7" r="4"/>
  <path d="M5 20h14a2 2 0 0 0-1.5-4H6.5A2 2 0 0 0 5 20z"/>
  <path d="M12 11l2 3l-2 2l-2-2l2-3z" fill="#2d3748" opacity="0.2"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#2d3748" opacity="0.8">
  <circle cx="12" cy="7" r="4"/>
  <path d="M4 18c0-3 3-5 8-5s8 2 8 5v2H4z" fill="#2d3748"/>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#2d3748" stroke-width="2">
  <circle cx="12" cy="8" r="3.5"/>
  <path d="M5 20c0-3 3-5 7-5s7 2 7 5"/>
</svg>
"@
    }
    "arrow_up" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#374151" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <line x1="12" y1="19" x2="12" y2="5"/>
  <polyline points="5 12 12 5 19 12"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1f2937" stroke-width="2">
  <path d="M12 3l7 7M12 3l-7 7M12 3v18"/>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#374151" stroke-width="2.5">
  <polyline points="12 5 5 12 12 5 19 12"/>
  <line x1="12" y1="5" x2="12" y2="19"/>
</svg>
"@
    }
    "arrow_down" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#374151" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <line x1="12" y1="5" x2="12" y2="19"/>
  <polyline points="19 12 12 19 5 12"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1f2937" stroke-width="2">
  <path d="M12 21l7-7M12 21l-7-7M12 21V3"/>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#374151" stroke-width="2.5">
  <polyline points="12 19 5 12 12 19 19 12"/>
  <line x1="12" y1="19" x2="12" y2="5"/>
</svg>
"@
    }
    "check" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="20 6 9 17 4 12"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#15803d" stroke-width="2.5">
  <path d="M20 6l-12 12l-4-4"/>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5">
  <polyline points="20 6 10 16 4 10" stroke="#16a34a" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
"@
    }
    "cross" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
  <line x1="18" y1="6" x2="6" y2="18"/>
  <line x1="6" y1="6" x2="18" y2="18"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#b91c1c" stroke-width="2.5">
  <line x1="18" y1="6" x2="6" y2="18"/>
  <line x1="6" y1="6" x2="18" y2="18"/>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5">
  <line x1="18" y1="6" x2="6" y2="18" stroke="#dc2626" stroke-linecap="round"/>
  <line x1="6" y1="6" x2="18" y2="18" stroke="#dc2626" stroke-linecap="round"/>
</svg>
"@
    }
    "warning" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#facc15" stroke="#eab308" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 2L2 20h20L12 2z"/>
  <line x1="12" y1="9" x2="12" y2="13"/>
  <line x1="12" y1="17" x2="12" y2="17.01"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#f59e0b" stroke="#d97706" stroke-width="1.5">
  <polygon points="12,3 3,18 21,18"/>
  <text x="12" y="16" font-size="8" fill="#fff" text-anchor="middle" font-weight="bold">!</text>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#facc15" stroke-width="2">
  <path d="M12 2l10 18H2z" stroke="#eab308"/>
  <line x1="12" y1="10" x2="12" y2="14" stroke="#eab308" stroke-width="1.5"/>
  <circle cx="12" cy="18" r="1" fill="#eab308"/>
</svg>
"@
    }
    "success" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#dbeafe" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="10" fill="#dbeafe"/>
  <polyline points="16 12 11 17 8 14"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#dcfce7" stroke="#15803d" stroke-width="2">
  <circle cx="12" cy="12" r="9" fill="#dcfce7"/>
  <polyline points="16 12 11 17 8 14"/>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2">
  <circle cx="12" cy="12" r="10"/>
  <polyline points="16 12 11 17 8 14" stroke="#16a34a" stroke-linecap="round"/>
</svg>
"@
    }
    "plus" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <line x1="12" y1="5" x2="12" y2="19"/>
  <line x1="5" y1="12" x2="19" y2="12"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2">
  <line x1="12" y1="5" x2="12" y2="19"/>
  <line x1="5" y1="12" x2="19" y2="12"/>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" stroke-width="2.5">
  <path d="M12 5v14M5 12h14" stroke="#0ea5e9" stroke-linecap="round"/>
</svg>
"@
    }
    "minus" = @{
        "01-flat-bold-color" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <line x1="5" y1="12" x2="19" y2="12"/>
</svg>
"@
        "02-isometric-3d-flat" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" stroke-width="2">
  <line x1="5" y1="12" x2="19" y2="12"/>
</svg>
"@
        "03-hand-drawn-doodle" = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2.5">
  <path d="M5 12h14" stroke="#6366f1" stroke-linecap="round"/>
</svg>
"@
    }
}

if (-not (Test-Path $baseDir)) {
    New-Item -ItemType Directory -Force $baseDir | Out-Null
}

$stats = @{
    total = 0
    assetTypes = 0
    byStyle = @{}
}

"01-flat-bold-color", "02-isometric-3d-flat", "03-hand-drawn-doodle" | ForEach-Object {
    $stats.byStyle[$_] = 0
}

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "Creating SVG Assets" -ForegroundColor Cyan
Write-Host "Cat Explainer Video Project" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

foreach ($assetType in $assetTemplates.Keys | Sort-Object) {
    $assetFolder = Join-Path $baseDir $assetType

    if (-not (Test-Path $assetFolder)) {
        New-Item -ItemType Directory -Force $assetFolder | Out-Null
    }

    Write-Host "Creating: $assetType" -ForegroundColor Yellow

    $sourceLines = @()

    foreach ($style in @("01-flat-bold-color", "02-isometric-3d-flat", "03-hand-drawn-doodle")) {
        if ($assetTemplates[$assetType].ContainsKey($style)) {
            $svgPath = Join-Path $assetFolder "$style.svg"
            $svgContent = $assetTemplates[$assetType][$style]

            Set-Content -Path $svgPath -Value $svgContent -Encoding UTF8

            $fileSize = ([System.IO.FileInfo]$svgPath).Length
            $fileSizeKB = [Math]::Round($fileSize / 1KB, 2)

            Write-Host "  [+] Created $style ($fileSizeKB KB)" -ForegroundColor Green
            $stats.total++
            $stats.byStyle[$style]++

            if ($style -eq "01-flat-bold-color") {
                $sourceLines += "$style.svg - Custom SVG (Flat Bold Color) Free / MIT"
            } elseif ($style -eq "02-isometric-3d-flat") {
                $sourceLines += "$style.svg - Custom SVG (Isometric 3D) Free / MIT"
            } else {
                $sourceLines += "$style.svg - Custom SVG (Hand-drawn Doodle) Free / MIT"
            }
        }
    }

    if ($sourceLines.Count -gt 0) {
        $sourceLines | Out-String | Set-Content -Path (Join-Path $assetFolder "source.txt") -Encoding UTF8
        Write-Host "  [+] Created source.txt" -ForegroundColor Cyan
    }

    Write-Host ""
    $stats.assetTypes++
}

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "Asset Creation Complete" -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Summary:" -ForegroundColor Cyan
Write-Host "  Asset Types: $($stats.assetTypes)"
Write-Host "  Total Files: $($stats.total)"
Write-Host ""
Write-Host "By Style:" -ForegroundColor Cyan
$stats.byStyle.GetEnumerator() | ForEach-Object {
    Write-Host "  $($_.Key): $($_.Value) files"
}

Write-Host ""
Write-Host "Asset Directory Structure:" -ForegroundColor Cyan

$assetDirs = Get-ChildItem -Path $baseDir -Directory | Sort-Object Name
$assetDirs | ForEach-Object {
    $assetName = $_.Name
    $files = @(Get-ChildItem -Path $_.FullPath -File | Where-Object { $_.Extension -eq ".svg" })
    $fileCount = $files.Count
    if ($fileCount -gt 0) {
        Write-Host "  |- $assetName/ ($fileCount SVGs)"
        $files | ForEach-Object {
            $size = [Math]::Round($_.Length / 1KB, 2)
            Write-Host "  |  |- $($_.Name) ($size KB)"
        }
        $sourceFile = Join-Path $_.FullPath "source.txt"
        if (Test-Path $sourceFile) {
            Write-Host "  |  |- source.txt"
        }
    }
}

$totalSize = (Get-ChildItem -Path $baseDir -Recurse -File | Measure-Object -Property Length -Sum).Sum
Write-Host ""
Write-Host "Total Folder Size: $([Math]::Round($totalSize / 1KB, 2)) KB" -ForegroundColor Cyan
Write-Host ""
Write-Host "Ready for use in: $baseDir" -ForegroundColor Green
