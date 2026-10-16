"""Generate sample STL / 3MF files for testing the shelf app."""
import math, struct, zipfile, json, os, sys, io, zlib

OUT = sys.argv[1] if len(sys.argv) > 1 else "fixtures/out"
os.makedirs(OUT, exist_ok=True)


def torus(R=20, r=7, nu=48, nv=24, z0=7):
    tris = []
    def p(u, v):
        a, b = 2 * math.pi * u / nu, 2 * math.pi * v / nv
        return ((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), z0 + r * math.sin(b))
    for i in range(nu):
        for j in range(nv):
            a, b, c, d = p(i, j), p(i + 1, j), p(i + 1, j + 1), p(i, j + 1)
            tris += [(a, b, c), (a, c, d)]
    return tris


def box(w, d, h, ox=0, oy=0, oz=0):
    x0, y0, z0, x1, y1, z1 = ox, oy, oz, ox + w, oy + d, oz + h
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    f = [(0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7), (0, 1, 5), (0, 5, 4), (1, 2, 6), (1, 6, 5), (2, 3, 7), (2, 7, 6), (3, 0, 4), (3, 4, 7)]
    return v, f


def write_binary_stl(path, tris):
    with open(path, "wb") as fh:
        fh.write(b"\0" * 80)
        fh.write(struct.pack("<I", len(tris)))
        for t in tris:
            fh.write(struct.pack("<3f", 0, 0, 0))
            for vtx in t:
                fh.write(struct.pack("<3f", *vtx))
            fh.write(b"\0\0")


def write_ascii_stl(path, v, f):
    with open(path, "w") as fh:
        fh.write("solid box\n")
        for a, b, c in f:
            fh.write(" facet normal 0 0 0\n  outer loop\n")
            for i in (a, b, c):
                fh.write("   vertex %f %f %f\n" % v[i])
            fh.write("  endloop\n endfacet\n")
        fh.write("endsolid box\n")


def png(w, h, rgb):
    raw = b"".join(b"\0" + bytes(rgb) * w for _ in range(h))
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def mesh_xml(v, f, paint=None):
    vs = "".join('<vertex x="%g" y="%g" z="%g"/>' % p for p in v)
    ts = "".join('<triangle v1="%d" v2="%d" v3="%d"%s/>' % (a, b, c, (' paint_color="%s"' % paint[i]) if paint and paint[i] else "") for i, (a, b, c) in enumerate(f))
    return "<mesh><vertices>%s</vertices><triangles>%s</triangles></mesh>" % (vs, ts)


def bambu_3mf(path, with_thumb=True):
    base_v, base_f = box(60, 40, 6)
    top_v, top_f = box(20, 20, 20, 20, 10, 6)
    paint = [None] * len(top_f)
    paint[2] = "8"; paint[3] = "8"  # top face painted extruder 2
    sub = ('<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
           '<resources><object id="1" type="model">%s</object><object id="2" type="model">%s</object></resources><build/></model>'
           % (mesh_xml(base_v, base_f), mesh_xml(top_v, top_f, paint)))
    root = ('<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" '
            'xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">'
            '<metadata name="Title">מעמד לטלפון</metadata><metadata name="Designer">MakerTest</metadata>'
            '<metadata name="Description">Sample multi-part model</metadata>'
            '<resources><object id="3" type="model"><components>'
            '<component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>'
            '<component p:path="/3D/Objects/object_1.model" objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>'
            '</components></object></resources>'
            '<build><item objectid="3" transform="1 0 0 0 1 0 0 0 1 98 108 0" printable="1"/></build></model>')
    model_settings = ('<?xml version="1.0" encoding="UTF-8"?><config><object id="3"><metadata key="name" value="stand"/>'
                      '<metadata key="extruder" value="1"/><part id="1" subtype="normal_part"><metadata key="extruder" value="1"/></part>'
                      '<part id="2" subtype="normal_part"><metadata key="extruder" value="3"/></part></object></config>')
    settings = {"layer_height": "0.2", "filament_type": ["PLA", "PLA", "PETG"], "filament_colour": ["#2B2B2B", "#FF6A13", "#3FA9F5"],
                "nozzle_temperature": ["220", "220", "250"], "hot_plate_temp": ["55", "55", "70"], "sparse_infill_density": "15%",
                "printer_model": "Bambu Lab P2S", "curr_bed_type": "Textured PEI Plate", "enable_support": "0", "wall_loops": "2",
                "filament_settings_id": ["Bambu PLA Basic @BBL P2S", "Bambu PLA Basic @BBL P2S", "Generic PETG"]}
    slice_info = ('<?xml version="1.0" encoding="UTF-8"?><config><plate><metadata key="index" value="1"/>'
                  '<metadata key="prediction" value="5025"/><metadata key="weight" value="23.41"/>'
                  '<filament id="1" type="PLA" color="#2B2B2B" used_m="5.2" used_g="15.5"/>'
                  '<filament id="3" type="PETG" color="#3FA9F5" used_m="2.4" used_g="7.91"/></plate></config>')
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types/>')
        z.writestr("3D/3dmodel.model", root)
        z.writestr("3D/Objects/object_1.model", sub)
        z.writestr("Metadata/model_settings.config", model_settings)
        z.writestr("Metadata/project_settings.config", json.dumps(settings))
        z.writestr("Metadata/slice_info.config", slice_info)
        if with_thumb:
            z.writestr("Metadata/plate_1.png", png(64, 64, (255, 106, 19)))


def simple_3mf(path):
    v, f = box(30, 30, 30)
    xml = ('<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
           '<resources><object id="1" type="model">%s</object></resources><build><item objectid="1"/></build></model>' % mesh_xml(v, f))
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("3D/3dmodel.model", xml)


def multi_plate_3mf(path):
    objs, items, plates = [], [], []
    for i in range(4):
        v, f = box(30 + i * 5, 30, 10 + i * 8)
        objs.append('<object id="%d" type="model">%s</object>' % (i + 1, mesh_xml(v, f)))
        # Bambu lays plates out side by side (plate pitch ~ 307 mm)
        items.append('<item objectid="%d" transform="1 0 0 0 1 0 0 0 1 %d %d 0"/>' % (i + 1, 110 + (i % 2) * 307, 110 - (i // 2) * 307))
        plates.append('<plate><metadata key="plater_id" value="%d"/><metadata key="plater_name" value="%s"/><model_instance><metadata key="object_id" value="%d"/><metadata key="instance_id" value="0"/></model_instance></plate>' % (i + 1, "" if i else "Base", i + 1))
    xml = ('<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
           '<resources>%s</resources><build>%s</build></model>' % ("".join(objs), "".join(items)))
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("3D/3dmodel.model", xml)
        z.writestr("Metadata/model_settings.config", '<?xml version="1.0"?><config>%s</config>' % "".join(plates))
        for i, c in enumerate([(230, 80, 60), (60, 160, 90), (70, 110, 220), (200, 170, 40)]):
            z.writestr("Metadata/plate_%d.png" % (i + 1), png(128, 128, c))
        z.writestr("Metadata/project_settings.config", json.dumps({"printable_area": ["0x0", "256x0", "256x256", "0x256"], "printer_model": "Bambu Lab P2S"}))


os.makedirs(os.path.join(OUT, "כלים"), exist_ok=True)
os.makedirs(os.path.join(OUT, "Toys"), exist_ok=True)
write_binary_stl(os.path.join(OUT, "Toys", "donut.stl"), torus())
write_binary_stl(os.path.join(OUT, "Toys", "donut_v2.stl"), torus(R=22, r=6))
v, f = box(40, 20, 10)
write_ascii_stl(os.path.join(OUT, "כלים", "קופסה.stl"), v, f)
bambu_3mf(os.path.join(OUT, "phone_stand.3mf"))
bambu_3mf(os.path.join(OUT, "phone_stand_nothumb.gcode.3mf"), with_thumb=False)
simple_3mf(os.path.join(OUT, "כלים", "cube.3mf"))
multi_plate_3mf(os.path.join(OUT, "four_plates.3mf"))
print("ok", OUT)
