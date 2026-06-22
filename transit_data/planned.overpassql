[out:json][timeout:300];
(
relation["ref"="M12"](40.78,28.00,41.65,29.95);
relation["ref"="T6"](40.78,28.00,41.65,29.95);
relation["ref"="T7"](40.78,28.00,41.65,29.95);
relation["ref"="M10"](40.78,28.00,41.65,29.95);
relation["ref"="M11"]["name"~"Halkalı",i](40.78,28.00,41.65,29.95);
relation["ref"="M7"]["name"~"Yıldız",i](40.78,28.00,41.65,29.95);
relation["ref"="M4"]["name"~"Tuzla",i](40.78,28.00,41.65,29.95);
)->.r;
.r out geom;
node(r.r);
out;
