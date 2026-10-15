'use strict';
// Complete workArea rectangles include negative-origin secondary displays.
function visibleBounds(bounds, areas, primary) {
  const overlap = area => Math.max(0, Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)) *
    Math.max(0, Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y));
  const area = areas.reduce((best, candidate) => overlap(candidate) > overlap(best) ? candidate : best, primary);
  return { ...bounds,
    x: Math.round(bounds.width > area.width ? area.x + area.width - bounds.width : Math.min(area.x + area.width - bounds.width, Math.max(area.x, bounds.x))),
    y: Math.round(bounds.height > area.height ? area.y + area.height - bounds.height : Math.min(area.y + area.height - bounds.height, Math.max(area.y, bounds.y)))
  };
}
module.exports = { visibleBounds };
