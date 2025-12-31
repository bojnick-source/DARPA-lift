import xml.etree.ElementTree as ET

from synthmuscle.mjcf.generator import MJCFGenerator, MJCFGenConfig


def _minimal_morph():
    return {
        "nodes": {
            "root": {
                "parent": None,
                "pos": [0, 0, 0.5],
                "quat": [1, 0, 0, 0],
                "geom": {"type": "box", "size": [0.05, 0.05, 0.05], "rgba": [0.8, 0.2, 0.2, 1.0]},
                "mass": 2.0,
            },
            "leg": {
                "parent": "root",
                "pos": [0, 0, -0.2],
                "quat": [1, 0, 0, 0],
                "joint": {"name": "hip", "type": "hinge", "axis": [1, 0, 0], "range": [-1.0, 1.0]},
                "geom": {"type": "capsule", "size": [0.03, 0.15], "rgba": [0.2, 0.2, 0.8, 1.0]},
                "mass": 1.0,
            },
        }
    }


def test_mjcf_parseable_and_deterministic():
    gen = MJCFGenerator(MJCFGenConfig(root_name="root", model_name="test_model", add_ground=True))
    morph = _minimal_morph()
    actuators = [{"name": "hip_motor", "joint": "hip", "gear": 80.0, "ctrlrange": [-1, 1]}]
    sensors = [{"type": "jointpos", "name": "hip_pos", "joint": "hip"}]

    xml1 = gen.generate(morphology=morph, actuators=actuators, sensors=sensors, geometry_params={"geom.test": 1.0}, meta={"design_hash": "abc"})
    xml2 = gen.generate(morphology=morph, actuators=actuators, sensors=sensors, geometry_params={"geom.test": 1.0}, meta={"design_hash": "abc"})

    assert xml1 == xml2

    root = ET.fromstring(xml1)
    assert root.tag == "mujoco"
    assert root.attrib.get("model") == "test_model"

    assert root.find("worldbody") is not None
    assert root.find("actuator") is not None
    assert root.find("sensor") is not None

    world = root.find("worldbody")
    bodies = list(world.findall("body"))
    assert any(b.attrib.get("name") == "root" for b in bodies)
