import unittest

from src.board import HEIGHT, WIDTH, free_cells, in_bounds, render
from src.summary import KEY_ORDER, SCHEMA, to_line


class BoardTests(unittest.TestCase):
    def test_the_playfield_is_forty_by_twenty(self):
        self.assertEqual((WIDTH, HEIGHT), (40, 20))

    def test_bounds_exclude_every_cell_off_the_edge(self):
        self.assertTrue(in_bounds(0, 0))
        self.assertTrue(in_bounds(39, 19))
        self.assertFalse(in_bounds(-1, 0))
        self.assertFalse(in_bounds(40, 0))
        self.assertFalse(in_bounds(0, -1))
        self.assertFalse(in_bounds(0, 20))

    def test_free_cells_skip_the_snake_and_run_row_major(self):
        free = free_cells([(1, 0), (0, 0)])
        self.assertEqual(len(free), WIDTH * HEIGHT - 2)
        self.assertEqual(free[0], (2, 0))
        self.assertEqual(free[WIDTH - 3], (39, 0))
        self.assertEqual(free[WIDTH - 2], (0, 1))
        self.assertNotIn((0, 0), free)
        self.assertNotIn((1, 0), free)

    def test_a_rendered_board_is_819_characters_with_one_head(self):
        board = render([(2, 0), (1, 0), (0, 0)], (5, 3))
        self.assertEqual(len(board), 819)
        self.assertEqual(board.count("/"), HEIGHT - 1)
        self.assertEqual(board.count("@"), 1)
        self.assertEqual(board.count("#"), 2)
        self.assertEqual(board.count("*"), 1)
        rows = board.split("/")
        self.assertEqual(rows[0][:3], "##@")
        self.assertEqual(rows[3][5], "*")

    def test_a_board_with_no_food_carries_no_star(self):
        self.assertEqual(render([(0, 0)], None).count("*"), 0)


class SummaryTests(unittest.TestCase):
    def test_the_key_order_is_the_contract(self):
        self.assertEqual(KEY_ORDER[0], "schema")
        self.assertEqual(KEY_ORDER[-1], "board")
        self.assertEqual(len(KEY_ORDER), 16)
        self.assertEqual(SCHEMA, "tui-snake/1")

    def test_a_line_is_compact_and_in_key_order(self):
        fields = {key: 0 for key in KEY_ORDER}
        fields["schema"] = SCHEMA
        fields["paused"] = False
        fields["food"] = None
        fields["head"] = [1, 2]
        fields["snake"] = [[1, 2]]
        fields["direction"] = "RIGHT"
        fields["status"] = "alive"
        fields["board"] = "x"
        line = to_line(fields)
        self.assertTrue(line.startswith('{"schema":"tui-snake/1","seed":0,'))
        self.assertTrue(line.endswith('"board":"x"}'))
        self.assertNotIn(", ", line)
        self.assertNotIn(": ", line)
        self.assertIn('"paused":false', line)
        self.assertIn('"food":null', line)

    def test_a_missing_or_unknown_key_is_refused(self):
        fields = {key: 0 for key in KEY_ORDER}
        short = dict(fields)
        del short["board"]
        with self.assertRaises(KeyError):
            to_line(short)
        wide = dict(fields)
        wide["extra"] = 1
        with self.assertRaises(KeyError):
            to_line(wide)


if __name__ == "__main__":
    unittest.main()
