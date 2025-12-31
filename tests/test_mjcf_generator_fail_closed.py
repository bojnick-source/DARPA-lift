import pytest

from synthmuscle.mjcf.generator import MJCFGenerator, MJCFGenConfig


def test_missing_parent_fails():
    gen = MJCFGenerator(MJCFGenConfig(root_name="root"))
    morph = {
        "nodes": {
            "root": {"parent": None, "pos": [0, 0, 0], "quat": [1, 0, 0, 0], "geom": {"type": "box", "size": [0.1, 0.1, 0.1]}},
            "child": {"parent": "nope", "pos": [0, 0, 0], "quat": [1, 0, 0, 0], "geom": {"type": "box", "size": [0.1, 0.1, 0.1]}},
        }
    }
    with pytest.raises(Exception):
        gen.generate(morphology=morph)


def test_geom_without_size_fails():
    gen = MJCFGenerator(MJCFGenConfig(root_name="root"))
    morph = {
        "nodes": {
            "root": {"parent": None, "pos": [0, 0, 0], "quat": [1, 0, 0, 0], "geom": {"type": "box"}}
        }
    }
    with pytest.raises(Exception):
        gen.generate(morphology=morph)
