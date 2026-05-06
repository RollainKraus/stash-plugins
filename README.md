## Plugins
- [Edit Tags Overhaul](#Edit-Tags-Overhaul)
- [Details Tags Overhaul](#Details-Tags-Overhaul)
- [Performer Tags Overhaul](#Performer-Tags-Overhaul)
- [Performer Tag Based Supporting Images](#Performer-Tag-Based-Supporting-Images)
- [Tag Based Browser](#Tag-Based-Browser)
- [Simple Image Crop](#Simple-Image-Crop)
- [Tag Sidebar](#Tag-Sidebar)
- [Custom Tags Manager](#Custom-Tags-Manager)
- [Organize Images By Performer](#Organize-Images-By-Performer)
- [Visage](#Visage)
- [Simple Right Click Tagging](#Simple-Right-Click-Tagging)
- [Background Images Slideshow](#Background-Images-Slideshow)
- [Studio Dashboard](#Studio-Dashboard)
- [Stash Dashboard](#Stash-Dashboard)

## Installation

1. Available Plugins >> Add Source

Source Name: RollainKraus

Source URL: [https://rollainkraus.github.io/stash-plugins/main/index.yml](https://rollainkraus.github.io/stash-plugins/main/index.yml)

2. Click Checkbox >> Install

3. Reload Plugins


# Edit Tags Overhaul

The edit tab now has Tag Groups organized by your parent-child tags and supports nesting for an additional group. Applies to scenes, images and galleries.


- **NEW** Added back the original tag search field but it also ties in to the toggle system now. Toggle tags directly from the search tab or navigate to where the tag is in the hierarchy
- Set up hierarchies and sort order by setting parent-child tag relationships and using sort names for tags. If sort name does not exist defaults to tag name
- Clicking on tags adds that tag to the scene/image/gallery
- Middle mouse pressing on the tag opens the tag page
- Tag Groups can be toggled on with the + button, useful if a tag you use as a group header is also a relevant tag for the content
- Tag buttons can use text, image, or text and image
- Size of image displays and the color of the border highlight can be customized
- Setting to allow tags with multiple parents to exist under each parent, useful if a tag is relevant to different groups

<h2>How To</h2>

To create the headers/groups you will need to set up your tags with parent-child relationships:

- parent >> tag
- parent >> subgroup >> tag

Use Sort Name to rearrange how the groups, subgroups and tags are ordered in the hierarchy

Without parents, tags automatically go in ‘Ungrouped’

<h2>Preview</h2>
<p>
  <img src="/pluginPreviews/EditTagsOverhaulPreview.gif" alt="EditTagsOverhaul preview" width="600">
</p>

<h2>Search Preview</h2>
<p>
  <img src="/pluginPreviews/EditTagsOverhaulSEARCHPreview.png" alt="EditTagsOverhaul search" width="600">
</p>

<h2>Settings Preview</h2>
<p>
  <img src="/pluginPreviews/EditTagsOverhaulSettingsPreview.png" alt="EditTagsOverhaul settings" width="600">
</p>

# Details Tags Overhaul

The details tab now has Tag Groups organized by your parent-child tags and supports nesting for an additional group. Applies to scenes, images and galleries.

- Set up hierarchies and sort order by setting parent-child tag relationships and using sort names for tags. If sort name does not exist defaults to tag name
- Clicking on tags will open the tag page (optional setting to enable this function on parent groups)
- Tag buttons can use text, image, or text and image
- Size of image displays can be customized

<h2>How To</h2>

To create the headers/groups you will need to set up your tags with parent-child relationships:

- parent >> tag
- parent >> subgroup >> tag

Use Sort Name to rearrange how the groups, subgroups and tags are ordered in the hierarchy

Without parents, tags automatically go in ‘Ungrouped’
<h2>Preview</h2>
<p>
  <img src="/pluginPreviews/DetailsTagsOverhaulPreview.gif" alt="DetailsTagsOverhaul preview" width="600">
</p>

<h2>Settings Preview</h2>
<p>
  <img src="/pluginPreviews/DetailsTagsOverhaulSettingsPreview.png" alt="DetailsTagsOverhaul settings" width="600">
</p>

# Performer Tags Overhaul

The Performer page now supports the same functionality from EditTagsOverhaul and DetailsTagsOverhaul: A hierarchical toggle based tagging interface and display mode heavily reliant on user-set parent-child tag relationships

Display Mode makes performer tags much more legible and organized, useful if you want to add tags like 'Roles this character has played in scenes' or 'Accessories used in scenes' without cluttering the performer page with tags

- Adds a new 'Tags Panel' to the performer page, replacing the default tags field
- 2 modes: Display and Edit: 
  - Display mode shows selected tags 
  - Edit mode switches to a hierarchical toggle based tagging system
- Set up hierarchies and sort order by setting parent-child tag relationships and using sort names for tags. If sort name does not exist defaults to tag name
- Clicking on tags adds that tag to the performer
- Middle mouse pressing on the tag opens the tag page (performer tab of tag page)
- Tag Groups can be toggled on with the + button, useful if a tag you use as a group header is also a relevant tag for the performer
- Tag buttons can use text, image, or text and image
- Lots of customization most of which can be set independently across both modes:
  - Size of image displays
  - Column number
  - Border highlight color
  - Font size/color 
  - Background fill/transparency

<h2>How To</h2>

To create the headers/groups you will need to set up your tags with parent-child relationships:

- parent >> tag
- parent >> subgroup >> tag

Use Sort Name to rearrange how the groups, subgroups and tags are ordered in the hierarchy

Without parents, tags automatically go in ‘Ungrouped’

<h2>Preview</h2>
<p>
  <img src="/pluginPreviews/PerformerTagsOverhaulPreview.gif" alt="PerformerTagsOverhaul preview" width="600">
</p>

<h2>Text and Image Display Mode Preview</h2>
<p>
  <img src="/pluginPreviews/PerformerTagsSubGroupsPreviewTextAndImageMode.png" alt="PerformerTagsOverhaul search" width="600">
</p>

<h2>Text Display Mode Preview</h2>
<p>
  <img src="/pluginPreviews/PerformerTagsSubGroupsPreviewTextMode.png" alt="PerformerTagsOverhaul search" width="600">
</p>

<h2>Settings Preview</h2>
<p>
  <img src="/pluginPreviews/PerformerTagsOverhaulSettingsPreview.png" alt="PerformerTagsOverhaul settings" width="600">
</p>


# Performer Tag Based Supporting Images

The Performer Page now supports a column of mini galleries that use your tags.
These act as themed supporting images directly on the performer page that you can customize.

- Tag performer images and choose which tags are displayed per slot, supports multiple tags and filters like 'all' and 'any'
- Up to 6 slots
- Clicking on the slot label will filter images using that slot's tags
- Clicking on the image will open the image in a new tab
- Slots support multiple images and cropping for each image
- Aspect ratio of slot is determined by the initial image, but can be manually changed by cropping any image
  - if a slot has multiple images, they will inherit the latest cropped aspect ratio
- size of the supporting images column can be increased
- Lots of customization including color, opacity, font, and sizing for buttons/labels and background
  - Can change if the label appears as a header or as part of the footer, as well as custom label names per slot
- The panel can loop as you scroll, best kept enabled if you have multiple slots active
- If multiple images are assigned to a slot, the image display can be set to 'first' (based on the image name), or 'random'

Intended to work alongside PerformerTagsOverhaul, but works as its own standalone plugin and with some other performer page plugins/themes but largely untested

<h2>How To</h2>

** The panel will not show up unless you have set up the slots and have images that fit the criteria

1. Find images you want to display in the supporting images panel
2. Insure they are assigned to the performer
3. Add tags - for example: based on outfit, clothed, nude or different features
4. In the plugin settings, add one or more tags to a slot and optionally change the label of that slot
6. They should appear in the performer page in their own column on the right
7. Crop the images to isolate the specific feature you want to highlight or to just better fit the image in the panel

<h2>Preview</h2>
<p>
  <img src="/pluginPreviews/PerformerTagBasedSupportingImagesPreview.gif" alt="DetailsTagsOverhaul preview" width="600">
</p>

<h2>Settings Preview</h2>
<p>
  <img src="/pluginPreviews/PerformerTagBasedSupportingImagesSettingsPreview.png" alt="DetailsTagsOverhaul settings" width="600">
</p>

-- to do -- add support for images with subtags to be shown as well (example, any image tagged with a subtag of Clothes will be shown in a slot set to the tag Clothes)

# Tag Based Browser

**ALPHA - EXPERIMENTAL
Shouldn't break anything, but several known issues and UI/UX pain points + missing planned features.
- Initial startup takes a long time to load, might require reloading plugins/refreshing/restarting a few times.

Adds a new stash page that uses a tag based content browser filter.
This recreates the content browser functionality of scenes, images, galleries, studios and performers in a self contained tag-based browser.

- New Tag Browser page for filtering through scenes, images, galleries, studios and performers with tags
- Options for including child tags, single or multi select with 'any' and 'all' behavior
- Clicking on content opens the content page
- Shows approximate count of all content with selected tags

**Known Issues

- Refreshing Tag Browser returns 404
- Approximate aggregate content counter is wildly inaccurate 
- UI scales/adjust poorly
- Missing information and sort rules normally displayed via stash (scene description, O-count, resolution, etc)
- Initial startup takes a long time to load, might require reloading plugins/refreshing/restarting a few times
(Recreating stash's browsing functionality is not ideal but I couldn't think of another way to unify different categories under one browser menu, also I didn't want to risk breaking anything. This plugin in particular is certified 100% AI slop. If the idea sticks it would be nice for an actual programmer to try something like this)

**Planned Features

- Tag Selection Presets: this is redundant since you can do the same with stash's own content browsers but it feels like a natural feature in the context of this plugin
- Add missing metadata displays and sort rules
- UI customization

# Simple Image Crop

Adds a button to crop images from the edit image tab.

- Crop images with freeform or snap mode with a handful of preset aspect ratios
- Cropped images display as cropped from other pages/tabs
- Badge overlay to show that an image has a custom crop applied (toggleable and adjustable opacity)

<h2>Preview</h2>
<p>
  <img src="/pluginPreviews/SimpleImageCropPreview.gif" alt="SimpleImageCrop preview" width="600">
</p>

<h2>Settings Preview</h2>
<p>
  <img src="/pluginPreviews/SimpleImageCropSettingsPreview.png" alt="SimpleImageCrop settings" width="600">
</p>

# Tag Sidebar

Adds an additional sidebar to content pages. This is a hierarchical tag menu to make sorting through long lists of tags easier for applying filters based on your parent-child tag relationships

- Standalone tag sidebar that stays open across content pages
- Can be set to 'sticky' mode so tag selection(s) persist when switching between content pages (scenes, images, etc)
- Supports multi select with any and all filtering and supports including or excluding sub tag content

<h2>How To</h2>

To create the headers/groups you will need to set up your tags with parent-child relationships:

- parent >> tag
- parent >> subgroup >> tag

Use Sort Name to rearrange how the groups, subgroups and tags are ordered in the hierarchy

Without parents, tags automatically go in ‘Ungrouped’

<h2>Preview</h2>
<p>
  <img src="/pluginPreviews/TagSidebarPreview.gif" alt="TagSidebar preview" width="600">
</p>

<h2>Settings Preview</h2>
<p>
  <img src="/pluginPreviews/TagSidebarSettingsPreview.png" alt="TagSidebar settings" width="600">
</p>

# Custom Tags Manager

Adds a standalone page for creating and managing tags. This provides an easy way to preview your current tag hierarchies and make edits/additions all in one place. 

- Standalone tag manager page that shows all your tags and their current hierarchies
- Can create, edit, merge and delete tags within the same page 
- Filters to help isolate incomplete tags or tags with multiple parents
- Adds multi-image support for tags

**This only supports tag hierarchies up to 3 layers deep. Any more layers and the hierarchies will break.
- parent >> tag (leaf tag)
- parent >> subgroup >> tag (leaf tag)


<h2>Preview</h2>
<p>
  <img src="/pluginPreviews/CustomTagsManagerTagEditPreview.png" alt="CustomTagsManager preview" width="600">
</p>

<p>
  <img src="/pluginPreviews/CustomTagsManagerNewTagPreview.png" alt="CustomTagsManager preview" width="600">
</p>

<p>
  <img src="/pluginPreviews/CustomTagsManagerSplitTagPreview.png" alt="CustomTagsManager preview" width="600">
</p>

<p>
  <img src="/pluginPreviews/CustomTagsManagerSupplementalImagesPreview.png" alt="CustomTagsManager preview" width="600">
</p>

<p>
  <img src="/pluginPreviews/CustomTagsManagerHoverTagPreview.png" alt="CustomTagsManager preview" width="600">
</p>

<p>
  <img src="/pluginPreviews/CustomTagsManagerButtonPreview.png" alt="CustomTagsManager preview" width="600">
</p>

<h2>Settings Preview</h2>
<p>
  <img src="/pluginPreviews/CustomTagsManagerSettingsPreview.png" alt="CustomTagsManager settings" width="600">
</p>

# Organize Images By Performer

Uses stash metadata to move images with attached performers into performer folders in a set directory.

** Be careful when using this: If you are already satisfied with your local image organization then this is not for you.

*** Also this plugin moves local files so you will have to rescan after each run to update new directories or else images may become detached.

- Set directories for Source and Destination folders (example '...To Sort' and '...Sorted')
- Bucket and Fanout modes. Bucket puts images with multiple performers in a _MULTI folder, Fanout copies that image into each directory for all attached performers
- Preview: Creates a log file to preview where images will be moved in to

<h2>Settings Preview</h2>
<p>
  <img src="/pluginPreviews/OrganizeImagesByPerformerSettingsPreview.png" alt="OrganizeImagesByPerformer preview" width="600">
</p>

<h2>Tasks Preview</h2>
<p>
  <img src="/pluginPreviews/OrganizeImagesByPerformerTasksPreview.png" alt="OrganizeImagesByPerformer settings" width="600">
</p>

# Visage

Roughly patched fork of the original Visage plugin: Uses facial recognition to identify performers based on a stashdb database.

Changes: The original code is largely unchanged. visage-marquee.js hijacks the original visage.js by using a manual marquee selection to isolate faces rather than the original face detection. 

<h2>Workflow Preview</h2>
<p>
  <img src="/pluginPreviews/VisageCropPreview.gif" alt="Visage preview" width="600">
</p>

Added helpful buttons if using the backend is preferred since there are more options there

Largely untested

All credit goes to the original uploader cc1234

# Simple Right Click Tagging

Simple menu to add tags or performers to images/scenes/performers directly from the content browser pages

- Supports multi-select for batch editing
- Images support Visage for quick 'right click >> edit performers >> crop >> find matches'  (Requires Visage)
- Right click or hover over right 1/3 of content card to show menu (hoverZone makes this compatible with other plugins that add right click menus)

<h2>Preview</h2>
<p>
  <img src="/pluginPreviews/SimpleRightClickTaggingPreview.gif" alt="SimpleRightClickTagging preview" width="600">
</p>
<p>
  <img src="/pluginPreviews/SimpleRightClickTaggingPerformerPreview.png" alt="SimpleRightClickTaggingPerformers preview" width="600">
</p>
<p>
  <img src="/pluginPreviews/SimpleRightClickTaggingTagsPreview.png.png" alt="SimpleRightClickTaggingTags preview" width="600">
</p>

# Background Images Slideshow

Fork of the original background images plugin. all credit goes to original uploader: https://github.com/ed36080666/stashapp_plugin_background_images/tree/main/src

- Added a slideshow mode
- Background can be split into up to 3 columns with customizable widths as a percentage or auto (best fit based on aspect ratio) and blending between columns

<h2>Preview</h2>
<p>
  <img src="/pluginPreviews/BackgroundImagesSlideshow.gif" alt="BackgroundImagesSlideshow preview" width="600">
</p>

# Studio Dashboard

*ALPHA ALPHA ALPHA - use at own risk - only up for testing

Adds a dashboard tab to studio pages to view top performers, top tags, scene release timelines and highlighted scenes

- Hovering over studio badges from other pages optionally shows a popout panel of a condensed dashboard or the full dashboard
- Dashboard elements like scene release timeline, performer and scene highlight rows, tag highlights and pie charts
- Up to 12 pie charts, 6 performer charts, 6 scene charts. 3 hardcoded charts each and 3 customizable charts each based on your tags
- Customize which tags to show by group (works best with tag hierarchies) with black/whitelist and exclusion rules
- Compares performer stats from studio content to all content

# Stash Dashboard

*ALPHA ALPHA ALPHA - use at own risk - only up for testing

Adds a dedicated dashboard page for stash-wide performer highlights, top tags, scene release timelines, highlighted scenes, and configurable pie charts

- Similar to 'Studio Dashboard' but covers content across your entire stash with optional exclusion rules
- Dashboard elements like scene release timeline, performer and scene highlight rows, tag highlights and pie charts
- Choose which studios to show on the dashboard, useful for summarizing content from specific studio selections
- Up to 12 pie charts, 6 performer charts, 6 scene charts. 3 hardcoded charts each and 3 customizable charts each based on your tags
- Customize which tags to show by group (works best with tag hierarchies) with black/whitelist and exclusion rules

How To:
- Open the dashboard page
- Load studio list
- Select all studios or only the studios you want in the dashboard
- Load selected studios (this takes a VERY long time depending on stash size)

## License

The default license is set to [AGPL-3.0](/LICENCE). Before publishing any plugins you can change it.

## AI Disclaimer

Heavy use of AI for everything
