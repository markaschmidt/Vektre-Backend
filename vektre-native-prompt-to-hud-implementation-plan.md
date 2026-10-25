<!-- Recovered from Codex task "gameUI hud" (thread 019faa4f-7537-7781-94b5-2122763a1e9b). -->
<!-- Original in-chat document ID: 62041. -->

Source context:

- GameUIAgent repository: https://github.com/zengwei-code/GameUIAgent
- AutoGameUI research paper: `auto-game-ui.pdf` (copied alongside this document)

# Vektre Native Prompt-to-HUD System

**Implementation split (build in parallel):**

- Backend (Nest + FastAPI worker): [`.cursor/plans/native-hud-backend_6d29da2c.plan.md`](/root/.cursor/plans/native-hud-backend_6d29da2c.plan.md)
- Desktop frontend contract: [`docs/HUD_FRONTEND_HANDOFF.md`](docs/HUD_FRONTEND_HANDOFF.md)
- Desktop frontend plan: [`.cursor/plans/native-hud-frontend_c3b91a04.plan.md`](/root/.cursor/plans/native-hud-frontend_c3b91a04.plan.md)

This document remains the product/architecture spec (UX tree, visual tree, matching, renderer requirements). Desktop work should follow the handoff for API/Yjs/reconcile details; do not call the FastAPI worker from the client.

## Objective

Implement a native Vektre workflow that turns a natural-language prompt and optional visual references into an editable, functional, high-quality game HUD.

The finished system must:

- Generate HUDs without requiring Figma, a Figma account, or a Figma plugin.
- Render and edit HUDs inside Vektre.
- Keep every element structured, editable, and semantically identified.
- Separate functional UX structure from visual UI styling.
- Support game-data bindings, states, responsive layouts, and spatial/VR placement.
- Use correspondence matching to combine a functional UX tree with a visual UI tree.
- Preserve hierarchy, anchors, rendering order, and game bindings.
- Support future Unity, Unreal, Godot, web, and optional Figma exporters.

Figma is not part of the core architecture. Do not use it for rendering, document storage, generation, validation, or previewing.

---

# Agent Process

## Step 1: Inspect Before Editing

Before writing code, inspect the entire relevant Vektre codebase and identify:

- Frontend framework and state-management system
- Existing canvas, scene, or 3D renderer
- Existing document/project format
- Existing asset-generation and asset-storage systems
- Existing AI-provider abstraction
- Existing schema-validation utilities
- Existing undo/redo implementation
- Existing export architecture
- Backend services, job queues, and persistence
- Testing frameworks and CI conventions

Do not assume a framework or introduce a parallel architecture unnecessarily.

## Step 2: Write Implementation Plans

Before editing production code, create a written plan containing:

- Relevant existing files and systems
- Proposed files and modules
- Data flow
- API and schema changes
- Migration strategy
- Testing strategy
- Work dependencies
- Risks and unresolved questions

Save the primary plan under a suitable location such as:

`docs/plans/native-hud-generation.md`

If multiple agents are working in parallel, each agent must produce a scoped sub-plan and identify the files it expects to modify. Avoid overlapping ownership unless explicitly coordinated.

## Step 3: Execute Incrementally

Implement the system in the phases described below. After each phase:

- Run applicable tests and type checking.
- Update the plan with completed work and deviations.
- Document new architectural decisions.
- Verify that existing Vektre projects remain compatible.
- Avoid unrelated refactors.

Only stop for user input when a decision materially changes product behavior and cannot be inferred from the existing codebase.

---

# Core Architecture

The system should use three structured representations.

## 1. UX Tree

The UX tree defines what the HUD does:

- Components and groups
- Parent-child hierarchy
- Layout and anchors
- Game-data bindings
- Visibility conditions
- Interaction behavior
- Component states
- Spatial surfaces
- Accessibility requirements

Example component types:

- Health, armor, stamina, and mana bars
- Ammunition counters
- Reticles
- Minimap and compass
- Objectives and quest tracking
- Ability and cooldown indicators
- Inventory and radial menus
- Damage-direction indicators
- Dialogue and subtitles
- Notifications
- Status effects
- Boss and encounter displays

## 2. Visual UI Tree

The visual tree defines how the HUD looks:

- Design tokens
- Typography
- Colors and gradients
- Borders and materials
- Icons
- Frames and ornamental assets
- Transparent PNG or SVG assets
- Nine-slice definitions
- Visual grouping
- Intended geometry
- Render order
- Animation motifs

Visual assets must remain layered. Never flatten an entire HUD into a single generated image.

Do not ask image-generation models to render final text. Text must remain native and editable.

## 3. Canonical HUD Document

The matching and composition stages merge the UX and visual trees into a canonical `HUDDocument`.

This is the authoritative Vektre representation used for:

- Native rendering
- Native editing
- Persistence
- Undo and redo
- State simulation
- Validation
- Engine export
- Optional Figma export

Use a versioned schema with migrations.

Suggested top-level structure:

```json
{
  "schemaVersion": 1,
  "metadata": {},
  "platformProfiles": [],
  "surfaces": [],
  "designTokens": {},
  "assets": {},
  "nodes": [],
  "bindings": [],
  "states": [],
  "animations": [],
  "constraints": []
}
```

Each node should support the appropriate subset of:

```json
{
  "id": "player_health",
  "kind": "progress_bar",
  "parentId": "vitals_group",
  "surfaceId": "left_wrist",
  "layout": {},
  "transform": {},
  "anchor": "center",
  "zIndex": 20,
  "styleRef": "primary_resource_bar",
  "assetRefs": [],
  "content": {},
  "binding": "player.health",
  "states": {},
  "interactions": [],
  "visibilityRules": [],
  "accessibility": {}
}
```

Use stable semantic IDs. Natural-language edits must target these IDs rather than regenerating the whole document.

---

# Required Core Interfaces

Adapt names and syntax to the existing Vektre stack.

```text
HUDDocumentRepository
HUDSchemaValidator
HUDMigrationService
HUDGenerationOrchestrator
UXTreeGenerator
VisualTreeGenerator
CorrespondenceMatcher
CorrespondenceSolver
HUDComposer
HUDLayoutEngine
HUDRenderer
HUDAssetResolver
HUDStateSimulator
HUDPatchService
HUDQualityValidator
HUDExporter
```

Provide dependency injection or the project’s existing equivalent so implementations can be replaced independently.

In particular, define a stable `CorrespondenceMatcher` interface so the deterministic MVP can later be replaced by a trained grouped-cross-attention model.

---

# Phase 1: Canonical Document and Native Renderer

Implement the versioned `HUDDocument` schema first.

Required capabilities:

- Parse and validate documents.
- Reject invalid parent references and cycles.
- Resolve design tokens and asset references.
- Calculate layout deterministically.
- Render all supported components inside Vektre.
- Save, reload, duplicate, and migrate HUD documents.
- Select and edit individual nodes.
- Support undo and redo.
- Preview multiple game states using simulated data.
- Render transparent SVG and PNG assets.
- Render text natively.
- Support clipping, gradients, borders, shadows, opacity, and nine-slice assets.
- Preserve deterministic z-order.

The renderer must not depend on Figma-generated node structures.

Create a small set of manually authored fixtures before implementing AI generation:

- Conventional desktop combat HUD
- Minimal exploration HUD
- Inventory overlay
- Boss encounter HUD
- VR wrist-mounted HUD

These fixtures become golden documents for renderer and migration tests.

---

# Phase 2: Functional UX Generation

Build a structured generation pipeline that converts a prompt into a valid UX tree.

The model should determine:

- Required information
- Component selection
- Information hierarchy
- Component grouping
- Placement and anchors
- Game bindings
- Visibility conditions
- States and transitions
- Platform-specific behavior
- Accessibility requirements

Use structured model output validated against the UX schema.

Do not accept arbitrary unvalidated JSON.

If generation fails validation:

1. Return machine-readable validation errors to the model.
2. Request a constrained repair.
3. Limit repair attempts.
4. Fall back to a valid base template if necessary.

Use the existing Vektre model-provider abstraction. Do not hardcode OpenRouter or expose model credentials to the client.

---

# Phase 3: Visual Direction and Layered Asset Generation

Generate a visual tree independently from the UX tree.

The visual stage should produce:

- Design tokens
- Component style definitions
- Layered frame pieces
- Icon requests
- Decorative motifs
- Material treatments
- Animation suggestions
- Typography choices
- Visual hierarchy
- A list of required generated assets

Use a hybrid system:

- Curated Vektre components for reliable structure
- Deterministic vector and layout rendering
- Generated transparent assets for ornaments, icons, emblems, and textures
- Native text for all labels and numbers

Implement style kits that can be saved and reused across multiple HUD screens.

A style kit should be applicable to:

- Combat HUD
- Inventory
- Settings
- Dialogue
- Map
- Character screens
- Other related interfaces

This is necessary for visual consistency across an entire game.

---

# Phase 4: Correspondence Matching

Implement a deterministic correspondence matcher before attempting to reproduce the paper’s trained model.

## Candidate Scoring

Calculate candidate match scores using:

- Geometry similarity
- Semantic type compatibility
- Textual similarity
- Shared group or region
- Parent-child compatibility
- Surface compatibility
- Rendering-order compatibility
- Anchor compatibility

Geometry should receive substantial initial weight because the AutoGameUI ablation showed it was the most important matching modality.

Make weights configurable and log individual score contributions for debugging.

## Hard Constraints

Reject matches that create:

- Incompatible semantic types
- Parent-child inversions
- Cyclic hierarchies
- Invalid spatial-surface assignments
- Prohibited anchor changes
- Rendering-order inversions
- Multiple assignments to exclusive components
- Loss of required game bindings

## Global Assignment

Do not select each match independently.

Use a global assignment solver compatible with the existing Vektre stack. Options include:

- OR-Tools on an existing Python or backend service
- A suitable min-cost matching implementation
- A constrained Hungarian or min-cost-flow implementation

Allow unmatched UX and visual nodes. Do not force weak matches.

## Hierarchical Matching

Match top-down:

1. Platform or spatial surface
2. Major HUD region
3. Component group
4. Individual component
5. Decorative and leaf nodes

For VR, never compare nodes across incompatible surfaces until their parent surfaces have been matched.

## Confidence

Return:

- Selected correspondence
- Confidence
- Alternative candidates
- Score breakdown
- Constraint warnings

Persist accepted and corrected matches for future training.

---

# Phase 5: Composition

Implement a composer that transfers visual properties onto the UX tree while preserving functional behavior.

The UX tree remains authoritative for:

- Component identity
- Bindings
- Interaction
- State behavior
- Accessibility
- Functional hierarchy

The visual tree is authoritative for:

- Styling
- Assets
- Typography
- Decoration
- Visual geometry when it does not violate UX constraints

Resolve conflicts explicitly. Do not silently overwrite functional properties with visual ones.

Composition should produce a valid `HUDDocument`, never an untyped intermediate object.

---

# Phase 6: Native HUD Editor

Add a native Vektre HUD workspace with:

- Prompt and reference input
- Generation-progress display
- Native HUD preview
- Scene or gameplay-image overlay
- Hierarchy panel
- Property inspector
- Design-token editor
- Asset browser
- State and game-data simulator
- Responsive-profile switcher
- Match-review interface
- Generation-history and variant comparison
- Undo and redo
- Natural-language editing

Natural-language edits must produce typed patches, not complete document rewrites.

Example patch:

```json
{
  "operation": "updateNode",
  "nodeId": "minimap",
  "changes": {
    "anchor": "top_left",
    "layout.opacity": 0.65
  }
}
```

Validate each patch before applying it.

Examples of supported editing commands:

- “Move the minimap to the upper left.”
- “Make exploration mode quieter.”
- “Only show ammunition while the weapon is raised.”
- “Move health to the player’s wrist.”
- “Use the same style as the inventory screen.”
- “Bring critical alerts closer to the center of vision.”

---

# Phase 7: Human-in-the-Loop Match Review

Do not require users to inspect every correspondence.

Open the match-review interface when:

- Confidence falls below a configurable threshold.
- A hard constraint cannot be satisfied.
- Multiple candidates have similar scores.
- Composition produces a validation failure.
- The user explicitly requests manual review.

The interface should show:

- UX and visual trees
- Existing correspondence lines
- Match confidence
- Alternative suggestions
- Unmatched nodes
- Constraint violations
- A rendered preview of the proposed result

Allow users to reassign matches by selecting or dragging between nodes.

Record corrections as anonymized training examples only under the product’s applicable privacy and consent model.

---

# Phase 8: Automated Quality Validation

Implement deterministic validation before adding a visual-model critic.

Validate:

- Overflow and overlap
- Text contrast
- Minimum text size
- Safe-area compliance
- Required component completeness
- Broken asset references
- Invalid bindings
- State completeness
- Render-order consistency
- Unsupported component types
- Responsive behavior
- VR angular size and viewing distance
- Occlusion and spatial-surface conflicts

A visual-model critic may subsequently evaluate:

- Aesthetic consistency
- Visual hierarchy
- Readability
- Reference-image alignment
- Genre and art-direction consistency

The critic must return typed patches or issue reports. It must never replace the entire `HUDDocument`.

Use a non-regression check after every correction.

---

# Phase 9: VR and Spatial HUD Support

Add spatial fields to the canonical schema:

- `surfaceType`: screen, head, body, controller, weapon, wrist, world
- World and local transforms
- Viewing distance
- Angular size
- Depth layer
- Occlusion priority
- Gaze behavior
- Ray interaction
- Hand interaction
- Voice interaction
- Comfort-zone classification
- Dominant-hand mirroring
- Per-eye or stereo behavior

Group correspondence matching by surface before matching individual components.

Include at least these test cases:

- Left-wrist health display
- Weapon-mounted ammunition counter
- World-locked objective marker
- Head-locked critical warning
- Controller-based radial menu

---

# Phase 10: Export Architecture

The canonical `HUDDocument` must not contain engine-specific implementation details.

Create exporter adapters:

```text
NativeVektreExporter
UnityHUDExporter
UnrealHUDExporter
GodotHUDExporter
WebHUDExporter
FigmaHUDExporter
```

Implement native Vektre persistence first.

Choose the first external engine exporter based on the existing Vektre product direction and codebase. Do not implement every exporter simultaneously.

The optional Figma exporter must be downstream of `HUDDocument`. Removing it must have no effect on generation, editing, validation, or rendering.

---

# Testing Requirements

## Unit Tests

Cover:

- Schema validation
- Schema migrations
- Tree cycle detection
- Layout calculations
- Anchor calculations
- Token resolution
- State transitions
- Patch validation
- Candidate scoring
- Constraint enforcement
- Assignment solving
- Composition conflict resolution
- Export translation

## Snapshot and Visual Tests

Use golden fixtures to verify:

- Deterministic rendering
- No unintended layout changes
- State variants
- Responsive profiles
- VR surfaces
- Asset fallbacks

If the repository supports screenshot comparison, establish visual regression baselines with explicit tolerances.

## Integration Tests

Test complete flows:

1. Prompt to UX tree
2. Prompt to visual tree
3. Matching and composition
4. Native rendering
5. Natural-language patching
6. Save and reload
7. Export

## Prompt Evaluation Suite

Create a stable prompt suite covering:

- Fantasy RPG
- Military science fiction
- Cozy farming game
- Horror survival
- Competitive shooter
- Mobile action RPG
- Minimal exploration game
- VR crafting game

Evaluate schema validity, component completeness, match confidence, visual consistency, and edit success.

---

# MVP Acceptance Criteria

The MVP is complete when a user can:

1. Prompt a complete HUD inside Vektre.
2. Receive an editable functional UX tree and visual direction.
3. Generate or select layered assets.
4. Compose the UX and visual trees through correspondence matching.
5. Render the result entirely inside Vektre.
6. Select and edit individual HUD elements.
7. Preview normal, combat, damaged, and critical states.
8. Apply a natural-language edit without regenerating the whole HUD.
9. Save and reopen the HUD without visual or semantic changes.
10. Correct an uncertain correspondence.
11. Preview at least one conventional screen HUD and one spatial VR HUD.
12. Export through at least one engine or runtime adapter.

No step may require Figma.

---

# Deferred Work

Do not make these prerequisites for the MVP:

- Training the paper’s grouped-cross-attention model
- Reproducing the proprietary GAMEUI dataset
- Supporting every game engine
- Full animation generation
- Multiplayer collaborative editing
- Figma export
- Fine-tuning a proprietary model

Design interfaces that permit these additions later.

---

# Recommended Agent Ownership

## Agent A: Document Model and Layout

Own:

- Schemas
- Migrations
- Layout engine
- Constraints
- Fixtures
- Unit tests

## Agent B: Native Renderer and Editor

Own:

- HUD renderer
- Hierarchy and property editing
- Preview modes
- State simulator
- Undo and redo
- Visual regression tests

## Agent C: Generation and Matching

Own:

- UX generation
- Visual-tree generation
- Structured-output validation
- Candidate scoring
- Assignment solver
- Composition
- Match confidence

## Agent D: Integration and Export

Own:

- Generation orchestration
- Persistence integration
- Asset pipeline integration
- Export adapter architecture
- End-to-end tests
- Documentation and feature flags

The lead agent should establish shared interfaces before parallel implementation begins.

---

# Engineering Guardrails

- Do not introduce Figma as a runtime dependency.
- Do not flatten HUDs into screenshots.
- Do not rasterize text through image generation.
- Do not let models rewrite entire valid documents during revisions.
- Do not hardcode one model provider.
- Do not expose provider credentials to clients.
- Do not force low-confidence correspondences.
- Do not discard game bindings during styling.
- Do not train a complex matching model before collecting suitable data.
- Do not place engine-specific properties in the canonical document.
- Keep generated designs editable, deterministic, and versioned.

