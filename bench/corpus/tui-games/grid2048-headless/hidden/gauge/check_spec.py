"""The graded suite for the headless 2048, per SPEC.md.

Every expectation is either pinned by the specification or produced by a
reference implementation validated against those pins: the three generator
vector rows, the five initial boards, the twelve-row merge table, and the three
recorded summary vectors the specification calls authoritative. Nothing here is
compared against the work tree's own recorded output.
"""

import unittest

from src.board import blank, copy
from src.moves import apply, slide_left
from src.replay import fields, replay
from src.rng import SplitMix64
from src.session import Session
from src.summary import to_line
from src.undo import CAPACITY, UndoStack


def line(seed, text):
    return to_line(fields(replay(seed, text)))


MERGE_TABLE = (
    ([2, 2, 2, 2], [4, 4, 0, 0], 8, [0, 0, 4, 4], 8),
    ([4, 4, 4, 4], [8, 8, 0, 0], 16, [0, 0, 8, 8], 16),
    ([2, 2, 4, 0], [4, 4, 0, 0], 4, [0, 0, 4, 4], 4),
    ([4, 4, 8, 0], [8, 8, 0, 0], 8, [0, 0, 8, 8], 8),
    ([4, 4, 2, 2], [8, 4, 0, 0], 12, [0, 0, 8, 4], 12),
    ([2, 0, 2, 4], [4, 4, 0, 0], 4, [0, 0, 4, 4], 4),
    ([4, 2, 2, 4], [4, 4, 4, 0], 4, [0, 4, 4, 4], 4),
    ([8, 4, 4, 2], [8, 8, 2, 0], 8, [0, 8, 8, 2], 8),
    ([8, 8, 8, 0], [16, 8, 0, 0], 16, [0, 0, 8, 16], 16),
    ([2, 4, 2, 4], [2, 4, 2, 4], 0, [2, 4, 2, 4], 0),
    ([0, 0, 2, 2], [4, 0, 0, 0], 4, [0, 0, 0, 4], 4),
    ([0, 2, 0, 2], [4, 0, 0, 0], 4, [0, 0, 0, 4], 4),
)

VECTOR_01 = "# vector-01\nL\nL\nU\nR\nD\nL\nU\nR\nD\nL\nZ\nL\nD\nQ\n"
VECTOR_01_LINE = (
    '{"schema":"tui-2048/1","seed":7,"grid":[[0,0,0,2],[0,0,0,0],[0,8,2,0],'
    '[8,2,4,2]],"score":28,"moves":10,"rejected":1,"undos":1,"ai_moves":0,'
    '"max_tile":8,"empty":9,"won":false,"status":"quit",'
    '"rng_state":"D5336963EEFBA1FF"}'
)

VECTOR_02 = "L\nD\n" * 30
VECTOR_02_LINE = (
    '{"schema":"tui-2048/1","seed":20250820,"grid":[[0,0,0,0],[2,0,0,0],'
    '[4,2,0,0],[16,8,2,0]],"score":60,"moves":13,"rejected":47,"undos":0,'
    '"ai_moves":0,"max_tile":16,"empty":10,"won":false,"status":"script_end",'
    '"rng_state":"8A8043BCEBEF8B3A"}'
)

VECTOR_03 = "U\nR\nD\nL\n" * 200
VECTOR_03_LINE = (
    '{"schema":"tui-2048/1","seed":3,"grid":[[128,2,4,8],[2,4,16,2],'
    '[16,8,64,8],[4,16,4,2]],"score":1260,"moves":133,"rejected":667,'
    '"undos":0,"ai_moves":0,"max_tile":128,"empty":0,"won":false,'
    '"status":"game_over","rng_state":"DE8261A4408EDE29"}'
)

VECTOR_04 = "L 5\nD 5\nZ 3\nL 2\nR 4\nZ\nU 3\n"
VECTOR_04_LINE = (
    '{"schema":"tui-2048/1","seed":42,"grid":[[8,4,2,0],[4,2,0,0],[0,2,0,0],'
    '[0,0,0,0]],"score":20,"moves":8,"rejected":7,"undos":4,"ai_moves":0,'
    '"max_tile":8,"empty":10,"won":false,"status":"script_end",'
    '"rng_state":"5C55827DF1D1B1CE"}'
)

VECTOR_05 = "L\nD\nL\nD\nL\nD\nL\nD\nL\nD\nZ 10\nL 2\n"
VECTOR_05_LINE = (
    '{"schema":"tui-2048/1","seed":11,"grid":[[2,0,0,0],[0,0,0,0],[4,2,0,0],'
    '[2,0,0,0]],"score":0,"moves":2,"rejected":4,"undos":10,"ai_moves":0,'
    '"max_tile":4,"empty":12,"won":false,"status":"script_end",'
    '"rng_state":"F1BBCDCBFA53E0B3"}'
)

VECTOR_06 = "L 3\nQ\nR 100\n"
VECTOR_06_LINE = (
    '{"schema":"tui-2048/1","seed":5,"grid":[[4,0,0,0],[0,0,0,2],[4,0,0,0],'
    '[0,0,0,0]],"score":8,"moves":3,"rejected":0,"undos":0,"ai_moves":0,'
    '"max_tile":4,"empty":13,"won":false,"status":"quit",'
    '"rng_state":"2E2AC13EF8E8D8D7"}'
)


class GeneratorTests(unittest.TestCase):
    def test_the_three_pinned_vector_rows(self):
        expected = {
            0: ["E220A8397B1DCDAF", "6E789E6AA1B965F4", "06C45D188009454F", "F88BB8A8724C81EC"],
            1: ["910A2DEC89025CC1", "BEEB8DA1658EEC67", "F893A2EEFB32555E", "71C18690EE42C90B"],
            42: ["BDD732262FEB6E95", "28EFE333B266F103", "47526757130F9F52", "581CE1FF0E4AE394"],
        }
        for seed, want in expected.items():
            rng = SplitMix64(seed)
            self.assertEqual(["%016X" % rng.next() for _ in range(4)], want, seed)


class MergeTests(unittest.TestCase):
    def test_the_pinned_row_table(self):
        for row, left, left_gain, right, right_gain in MERGE_TABLE:
            self.assertEqual(slide_left(list(row)), (left, left_gain), row)
            grid = [list(row), [0] * 4, [0] * 4, [0] * 4]
            moved, gain = apply(grid, "L")
            self.assertEqual((moved[0], gain), (left, left_gain), row)
            moved, gain = apply(grid, "R")
            self.assertEqual((moved[0], gain), (right, right_gain), row)

    def test_the_same_table_holds_down_a_column(self):
        for row, left, left_gain, right, right_gain in MERGE_TABLE:
            grid = [[row[r], 0, 0, 0] for r in range(4)]
            moved, gain = apply(grid, "U")
            self.assertEqual(([moved[r][0] for r in range(4)], gain), (left, left_gain), row)
            moved, gain = apply(grid, "D")
            self.assertEqual(([moved[r][0] for r in range(4)], gain), (right, right_gain), row)

    def test_a_merged_tile_does_not_merge_again_in_the_same_move(self):
        self.assertEqual(slide_left([2, 2, 4, 0]), ([4, 4, 0, 0], 4))
        self.assertEqual(slide_left([4, 4, 8, 0]), ([8, 8, 0, 0], 8))
        self.assertEqual(slide_left([8, 8, 8, 0]), ([16, 8, 0, 0], 16))

    def test_every_row_moves_independently_and_the_gains_add(self):
        grid = [[2, 2, 0, 0], [4, 4, 0, 0], [0, 0, 0, 0], [8, 0, 8, 0]]
        moved, gain = apply(grid, "L")
        self.assertEqual(moved, [[4, 0, 0, 0], [8, 0, 0, 0], [0, 0, 0, 0], [16, 0, 0, 0]])
        self.assertEqual(gain, 4 + 8 + 16)

    def test_a_move_leaves_the_grid_it_was_given_alone(self):
        grid = [[2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]
        apply(grid, "L")
        self.assertEqual(grid[0], [2, 2, 0, 0])


class SpawnTests(unittest.TestCase):
    def test_the_five_pinned_initial_boards(self):
        expected = {
            1: [[2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
            2: [[0, 0, 0, 0], [0, 0, 2, 0], [0, 0, 0, 0], [0, 0, 2, 0]],
            3: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 2, 0, 0], [0, 2, 0, 0]],
            7: [[0, 0, 0, 0], [0, 0, 2, 2], [0, 0, 0, 0], [0, 0, 0, 0]],
            20: [[0, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [2, 0, 0, 0]],
        }
        for seed, want in expected.items():
            self.assertEqual(Session(seed).grid, want, seed)

    def test_a_spawn_consumes_exactly_two_draws(self):
        session = Session(1)
        rng = SplitMix64(1)
        for _ in range(4):
            rng.next()
        self.assertEqual(session.rng.state, rng.state)


class LegalityTests(unittest.TestCase):
    def test_an_illegal_move_changes_nothing_and_draws_nothing(self):
        session = Session(1)
        before = copy(session.grid)
        state = session.rng.state
        self.assertFalse(session.legal("U"))
        self.assertFalse(session.move("U"))
        self.assertEqual(session.grid, before)
        self.assertEqual(session.rng.state, state)
        self.assertEqual((session.moves, session.rejected, session.score), (0, 1, 0))

    def test_a_pair_makes_a_direction_legal_that_compaction_alone_would_not(self):
        session = Session(1)
        self.assertTrue(session.legal("L"))
        self.assertTrue(session.move("L"))
        self.assertEqual(session.score, 4)
        self.assertEqual(session.moves, 1)

    def test_a_dead_board_rejects_every_direction(self):
        session = Session(1)
        session.grid = [[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]]
        self.assertFalse(session.any_legal())
        for direction in "LRUD":
            self.assertFalse(session.move(direction), direction)
        self.assertEqual(session.rejected, 4)


class UndoTests(unittest.TestCase):
    def test_the_stack_holds_at_least_twenty_entries(self):
        self.assertTrue(CAPACITY >= 20)

    def test_the_oldest_entry_is_discarded_at_capacity(self):
        session = Session(1)
        stack = UndoStack()
        for step in range(CAPACITY + 5):
            session.score = step
            session.moves = step
            session.grid = blank()
            session.grid[0][0] = 2 * (step + 1)
            stack.push(session)
        self.assertEqual(len(stack), CAPACITY)
        stack.restore(session)
        self.assertEqual(session.score, CAPACITY + 4)
        for _ in range(CAPACITY - 1):
            stack.restore(session)
        self.assertEqual(session.score, 5)
        self.assertEqual(len(stack), 0)

    def test_a_snapshot_carries_the_counter_and_the_generator_too(self):
        session = Session(1)
        grid = copy(session.grid)
        score, moves, state = session.score, session.moves, session.rng.state
        session.move("L")
        self.assertNotEqual(session.rng.state, state)
        self.assertTrue(session.undo_once())
        self.assertEqual(session.grid, grid)
        self.assertEqual(session.score, score)
        self.assertEqual(session.moves, moves)
        self.assertEqual(session.rng.state, state)

    def test_an_undo_may_not_be_used_to_reroll_a_spawn(self):
        first = Session(1)
        first.move("L")
        after_first = copy(first.grid)
        first.undo_once()
        first.move("L")
        self.assertEqual(first.grid, after_first)

    def test_the_move_counter_walks_back_with_the_undo(self):
        session = Session(1)
        session.move("L")
        session.move("L")
        self.assertEqual(session.moves, 2)
        session.undo_once()
        self.assertEqual(session.moves, 1)
        session.undo_once()
        self.assertEqual(session.moves, 0)

    def test_an_empty_stack_is_a_no_op_that_still_counts(self):
        session = Session(1)
        before = copy(session.grid)
        self.assertFalse(session.undo_once())
        self.assertEqual(session.undos, 1)
        self.assertEqual(session.grid, before)
        self.assertEqual(session.rejected, 0)
        self.assertEqual(session.moves, 0)


class VectorTests(unittest.TestCase):
    def test_vector_01_reproduces(self):
        self.assertEqual(line(7, VECTOR_01), VECTOR_01_LINE)

    def test_vector_02_reproduces(self):
        self.assertEqual(line(20250820, VECTOR_02), VECTOR_02_LINE)

    def test_vector_03_reproduces(self):
        self.assertEqual(line(3, VECTOR_03), VECTOR_03_LINE)

    def test_vector_04_reproduces(self):
        self.assertEqual(line(42, VECTOR_04), VECTOR_04_LINE)

    def test_vector_05_reproduces(self):
        self.assertEqual(line(11, VECTOR_05), VECTOR_05_LINE)

    def test_vector_06_reproduces(self):
        self.assertEqual(line(5, VECTOR_06), VECTOR_06_LINE)

    def test_a_replay_is_reproducible(self):
        self.assertEqual(line(3, VECTOR_03), line(3, VECTOR_03))


if __name__ == "__main__":
    unittest.main()
