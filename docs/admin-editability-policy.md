# Admin Editability & Customization Policy

## Purpose
All newly introduced user-facing features must provide admin-editable/customizable controls so product behavior can be adjusted without code changes.

## Policy Rule
Any new user-facing feature **must include admin editability/customization** unless a documented exemption is explicitly approved.

## Hard Requirement: Homepage Blocks
All **new user-facing homepage blocks** must satisfy every requirement below before merge:

1. **Registered in edit mode**
   - The block must expose a stable editable registration ID and participate in edit mode registration.
2. **Field-driven content**
   - User-facing copy and configurable values must come from editable fields/schema (not hardcoded strings embedded only in component markup).
3. **Persisted through approved storage**
   - Updates must persist via approved config/content storage paths (for example: canonical config documents, managed content records, or sanctioned app persistence keys).

## Implementation Checklist for New Blocks
When introducing a new homepage block, include:

- Editable registration ID(s)
- Schema path list for editable fields
- Persistence location(s) used by the block
- Screenshot showing edit controls in edit mode

## Minimum Requirements (All User-Facing Features)
Each qualifying feature must include all of the following:

1. **Visible control in settings/admin UI**
   - The feature must expose at least one clear control in the admin or settings surface that is discoverable by administrators.
2. **Persistence key**
   - The control state/value must map to a stable persistence key (for example in configuration, database, or equivalent settings storage).
3. **Sensible default**
   - A safe, documented default value must be provided so behavior is predictable when no explicit admin override exists.
4. **Migration note when needed**
   - If introducing or changing persisted settings requires migration, include a migration note describing impact and rollout expectations.
5. **Test coverage**
   - Tests must validate editability/customization behavior, including default handling and persistence behavior.

## Exemptions
If a feature cannot reasonably be made admin-editable, include an explicit exemption rationale in the PR and obtain approval from project maintainers.
