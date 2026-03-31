## Plugins
- [Edit Tags Overhaul](#Edit-Tags-Overhaul)
- [Details Tags Overhaul](#Details-Tags-Overhaul)
- [Performer Tags Overhaul](#Performer-Tags-Overhaul)
- [Performer Tag Based Supporting Images](#Performer-Tag-Based-Supporting-Images)

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

<h2>Preview</h2>
<p>
  <img src="/plugins/EditTagsOverhaul/images/EditTagsOverhaulPreview.gif" alt="EditTagsOverhaul preview" width="600">
</p>

<h2>Search Preview</h2>
<p>
  <img src="/plugins/EditTagsOverhaul/images/EditTagsOverhaulSEARCHPreview.png" alt="EditTagsOverhaul search" width="600">
</p>

<h2>Settings Preview</h2>
<p>
  <img src="/plugins/EditTagsOverhaul/images/EditTagsOverhaulSettingsPreview.png" alt="EditTagsOverhaul settings" width="600">
</p>

# Details Tags Overhaul

The details tab now has Tag Groups organized by your parent-child tags and supports nesting for an additional group. Applies to scenes, images and galleries.

- Set up hierarchies and sort order by setting parent-child tag relationships and using sort names for tags. If sort name does not exist defaults to tag name
- Clicking on tags will open the tag page (optional setting to enable this function on parent groups)
- Tag buttons can use text, image, or text and image
- Size of image displays can be customized

<h2>Preview</h2>
<p>
  <img src="/plugins/DetailsTagsOverhaul/images/DetailsTagsOverhaulPreview.gif" alt="DetailsTagsOverhaul preview" width="600">
</p>

<h2>Settings Preview</h2>
<p>
  <img src="/plugins/DetailsTagsOverhaul/images/DetailsTagsOverhaulSettingsPreview.png" alt="DetailsTagsOverhaul settings" width="600">
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

<h2>Preview</h2>
<p>
  <img src="/plugins/PerformerTagsOverhaul/images/PerformerTagsOverhaulPreview.gif" alt="PerformerTagsOverhaul preview" width="600">
</p>

<h2>Text and Image Display Mode Preview</h2>
<p>
  <img src="/plugins/PerformerTagsOverhaul/images/PerformerTagsSubGroupsPreviewTextAndImageMode.png" alt="PerformerTagsOverhaul search" width="600">
</p>

<h2>Text Display Mode Preview</h2>
<p>
  <img src="/plugins/PerformerTagsOverhaul/images/PerformerTagsSubGroupsPreviewTextMode.png" alt="PerformerTagsOverhaul search" width="600">
</p>

<h2>Settings Preview</h2>
<p>
  <img src="/plugins/PerformerTagsOverhaul/images/PerformerTagsOverhaulSettingsPreview.png" alt="PerformerTagsOverhaul settings" width="600">
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
5. They should appear in the performer page in their own column on the right
6. Crop the images to isolate the specific feature you want to highlight or to just better fit the image in the panel

<h2>Preview</h2>
<p>
  <img src="/plugins/PerformerTagBasedSupportingImages/images/PerformerTagBasedSupportingImagesPreview.gif" alt="DetailsTagsOverhaul preview" width="600">
</p>

<h2>Settings Preview</h2>
<p>
  <img src="/plugins/PerformerTagBasedSupportingImages/images/PerformerTagBasedSupportingImagesSettingsPreview.png" alt="DetailsTagsOverhaul settings" width="600">
</p>


Made with AI

## License

The default license is set to [AGPL-3.0](/LICENCE). Before publishing any plugins you can change it.
