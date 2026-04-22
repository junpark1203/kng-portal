# Design System Strategy: Precision & Tonal Depth

## 1. Overview & Creative North Star
**The Creative North Star: "The Financial Architect"**

In the world of B2B ERP and Fintech, users don't just need a dashboard; they need a high-fidelity instrument. This design system moves away from the "cluttered grid" of legacy ERPs toward a "Financial Architect" aesthetic—an editorial-inspired framework where data-heavy environments feel light, intentional, and authoritative. 

We break the "standard SaaS template" by utilizing **Tonal Layering** instead of rigid boxes. By using high-contrast typography scales (the authoritative Manrope paired with the functional Inter) and expansive whitespace, we treat payment management as a premium experience. The goal is to make the user feel in total control of the flow of capital through a UI that feels like a series of layered, frosted glass panes rather than a flat web page.

---

## 2. Colors & Surface Philosophy
The palette is rooted in deep institutional trust (`primary: #000666`) balanced by a contemporary, tech-forward mint (`secondary: #006a62`).

### The "No-Line" Rule
To achieve a premium, custom feel, **1px solid borders are prohibited for sectioning.** Boundaries must be defined solely through background color shifts.
*   **Action:** Place a `surface_container_lowest` card on top of a `surface_container_low` background. The subtle shift in hex value provides all the definition a professional eye needs.

### Surface Hierarchy & Nesting
Treat the UI as a physical stack of fine paper.
*   **Base Level:** `surface` (#f8f9fa) – The canvas.
*   **Layout Sections:** `surface_container_low` (#f3f4f5) – Used for sidebars or grouping content areas.
*   **Interactive Cards:** `surface_container_lowest` (#ffffff) – The highest "elevation" for data entry and primary content.
*   **Nested Details:** `surface_container_high` (#e7e8e9) – Used for accordion-expanded states within a table to create an "inset" feel.

### The "Glass & Gradient" Rule
For primary CTAs and global navigation, move beyond flat fills. 
*   **Signature Textures:** Use a subtle linear gradient (Top-Left to Bottom-Right) transitioning from `primary` (#000666) to `primary_container` (#1a237e). This adds "soul" and depth to the navy.
*   **Glassmorphism:** Floating modals or dropdowns should use `surface_container_lowest` at 85% opacity with a `20px` backdrop-blur. This integrates the component into the environment.

---

## 3. Typography
We use a dual-font strategy to balance editorial authority with data legibility.

*   **Display & Headlines (Manrope):** These are your "Editorial" voices. Use `display-lg` and `headline-md` to anchor pages. The wider apertures of Manrope convey modern sophistication.
*   **Functional Data (Inter):** All table data, labels, and body copy use Inter. It is chosen for its high x-height and exceptional readability at small sizes (`body-sm`: 0.75rem), crucial for multi-currency JPY/CNY/USD displays.
*   **The Hierarchy Rule:** Never use more than three levels of hierarchy on one screen. Use `title-sm` (Inter, Bold) for table headers and `label-md` for metadata to keep the interface breathable.

---

## 4. Elevation & Depth
Traditional drop shadows are too "heavy" for a modern Fintech platform. We use **Tonal Layering** and **Ambient Light**.

*   **The Layering Principle:** Avoid `elevation-1` shadows. Instead, stack `surface_container_lowest` on `surface_container_low`. The contrast difference provides the "lift."
*   **Ambient Shadows:** For floating elements (Modals/Popovers), use an extra-diffused shadow: `box-shadow: 0 12px 40px rgba(0, 7, 103, 0.06);`. Note the blue tint (`on_primary_fixed`) in the shadow; never use pure black or grey.
*   **The Ghost Border:** If accessibility requires a container edge (e.g., in high-contrast mode), use a "Ghost Border": `outline_variant` at 15% opacity. It should be felt, not seen.

---

## 5. Components

### Buttons
*   **Primary:** Gradient fill (`primary` to `primary_container`), `8px` corner radius, white text.
*   **Secondary:** Ghost style. No background, `primary` text, and a `15%` opacity `outline` only on hover.
*   **Tertiary:** `surface_container_high` background with `on_surface` text for low-priority actions.

### Multi-Currency Badges
*   **Style:** Pill-shaped (`full` roundedness). 
*   **Coloring:** Use `secondary_container` for the background and `on_secondary_container` for the text. 
*   **Intent:** The soft mint provides a "success-adjacent" feel that suggests liquidity and movement without the urgency of a status green.

### Accordion-Style Tables
*   **Container:** No borders. Each row is a `surface_container_lowest` block.
*   **The "Inset" Expand:** When a row is clicked, the accordion content should reveal itself on a `surface_container_high` background, creating a visual "pocket" within the table.
*   **Spacing:** Use `1.5rem` (xl) padding on the horizontal axis of rows to ensure the data feels "airy."

### Status Indicators
*   **Success:** `secondary` (Mint) – Represents "Cleared" or "Settled."
*   **Pending:** `primary_fixed_variant` (Soft Indigo) – Avoid orange unless it's a warning. In ERP, pending is a standard state, not a risk.
*   **Error:** `error` (#ba1a1a) – High contrast against `surface`.

### Input Fields
*   **Static State:** No border. Background set to `surface_container_highest`. 
*   **Active State:** `surface_container_lowest` background with a `2px` `primary` "Ghost Border" (20% opacity).

---

## 6. Do’s and Don’ts

### Do:
*   **Do** use `2.25rem` to `3.5rem` of whitespace between major logical sections.
*   **Do** align numerical data to the right in tables to allow for easy decimal comparison.
*   **Do** use `surface_container_lowest` for elements the user needs to interact with (the "Interactive Surface").

### Don't:
*   **Don't** use 1px dividers between table rows. Use a `12px` vertical gap and let the background color define the row.
*   **Don't** use high-saturation reds or greens for non-status elements. Keep the "soul" of the app in the Navy/Mint/Grey spectrum.
*   **Don't** use "Default" shadows. If an element doesn't have a diffused, tinted ambient shadow, it shouldn't have a shadow at all.