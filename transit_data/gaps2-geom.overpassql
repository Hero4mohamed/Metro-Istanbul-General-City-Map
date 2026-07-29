[out:json][timeout:150];
(
  node["amenity"="ferry_terminal"](38.30,26.70,38.60,27.35);
  node["railway"="tram_stop"](40.15,28.90,40.30,29.30);
  way["aerialway"~"gondola|cable_car|chair_lift"](40.05,29.05,40.28,29.40);
  node["aerialway"="station"](40.05,29.05,40.28,29.40);
);
out geom;
