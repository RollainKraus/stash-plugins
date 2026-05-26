name: Edit Tags Overhaul
description: Hierarchical tag browser with inline search, copy/paste, and fullscreen quick tagging for scene, gallery, and image pages
version: 1.5.1
url: https://github.com/RollainKraus/stash-plugins
settings:
  defaultExpanded:
    displayName: Default Expanded
    type: BOOLEAN
    description: Expand all hierarchies by default

  autoExpandIfSelected:
    displayName: Auto Expand If Selected
    type: BOOLEAN
    description: If parent tag has child tags toggled, expand the hierarchy by default

  duplicateMultiParentTags:
    displayName: Duplicate Multi-Parent Tags
    type: BOOLEAN
    description: Allow tags with multiple parents to exist under each parent

  panelTitle:
    displayName: Panel Title
    type: STRING

  displayMode:
    displayName: Tag Display Mode
    type: STRING
    description: text, image, or imageAndText

  imageSize:
    displayName: Image Size
    type: STRING

  selectedBorderColor:
    displayName: Selected Border Color
    type: STRING

  refreshSceneUIAfterSave:
    displayName: Refresh Scene UI After Save
    type: BOOLEAN
    description: Attempt to refresh Stash's native scene page data after tag changes without a full browser reload. Default false.

  enableFullscreenQuickTagPanel:
    displayName: Enable Fullscreen Quick Tag Panel
    type: BOOLEAN
    description: Show a floating Tags button during fullscreen scene playback. Default true.

  autoOpenFullscreenQuickTagPanel:
    displayName: Auto Open Fullscreen Quick Tag Panel
    type: BOOLEAN
    description: Automatically open the fullscreen quick tag menu when entering fullscreen. Default false.

  fullscreenQuickTagButtonPosition:
    displayName: Fullscreen Quick Tag Button Position
    type: STRING
    description: topright, topleft, bottomleft, or bottomright. Default bottomright.

  fullscreenQuickTagIdleOpacity:
    displayName: Fullscreen Quick Tag Idle Opacity
    type: STRING
    description: Panel opacity when the mouse is not hovering over it, from 0.02 to 1. Default 0.1.

  fullscreenQuickTagSharedHover:
    displayName: Fullscreen Quick Tag Shared Hover
    type: BOOLEAN
    description: Hovering any fullscreen quick tag panel keeps all fullscreen quick tag panels visible. Default false.

ui:
  javascript:
    - EditTagsOverhaul.js
  css:
    - EditTagsOverhaul.css
