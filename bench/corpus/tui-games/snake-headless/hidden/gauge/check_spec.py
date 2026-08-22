"""The graded suite for the headless snake, per SPEC.md.

Every expectation here is either pinned by the specification itself or produced
by a reference implementation validated against those pins: the two generator
sequences, the three first-food cells, the 1061-byte worked example, and the
two seed-independent operator vectors. Nothing is model-supplied and nothing is
compared against the work tree's own recorded output.
"""

import unittest

from src.board import HEIGHT, WIDTH, render
from src.engine import Game
from src.food import place
from src.replay import ScriptError, fields, parse, replay
from src.rng import Lcg
from src.summary import SCHEMA, to_line


def line(seed, text):
    return to_line(fields(replay(seed, text)))


WORKED_EXAMPLE = (
    '{"schema":"tui-snake/1","seed":42,"width":40,"height":20,"ticks":1,"status":"alive","score":0,"length":3,"food_eaten":0,"paused":false,"restarts":0,"direction":"RIGHT","head":[21,10],"food":[34,6],"snake":[[21,10],[20,10],[19,10]],"board":"......................................../......................................../......................................../......................................../......................................../......................................../..................................*...../......................................../......................................../......................................../...................##@................../......................................../......................................../......................................../......................................../......................................../......................................../......................................../......................................../........................................"}'
)

CHASE_42 = "UP\nTICK 4\nRIGHT\nTICK 14\nUP\nTICK 2\nLEFT\nTICK 26\nUP\nTICK 4\nLEFT\nTICK 6\nDOWN\nTICK\nRIGHT\nTICK 6\n"
CHASE_1 = "UP\nTICK 4\nRIGHT\nTICK 5\nUP\nTICK 3\nLEFT\nTICK 2\nDOWN\nTICK 12\nLEFT\nTICK 10\n"


class GeneratorTests(unittest.TestCase):
    def test_both_pinned_sequences_reproduce(self):
        self.assertEqual(
            _first_six(1),
            [1015568748, 1586005467, 2165703038, 3027450565, 217083232, 1587069247],
        )
        self.assertEqual(
            _first_six(42),
            [1083814273, 378494188, 2479403867, 955863294, 1613448261, 110225632],
        )

    def test_the_seed_is_taken_modulo_two_to_the_thirty_two(self):
        self.assertEqual(_first_six(1 + (1 << 32)), _first_six(1))

    def test_every_output_is_a_thirty_two_bit_value(self):
        rng = Lcg(20250820)
        for _ in range(200):
            value = rng.next()
            self.assertIsInstance(value, int)
            self.assertTrue(0 <= value < (1 << 32))


def _first_six(seed):
    rng = Lcg(seed)
    return [rng.next() for _ in range(6)]


class FoodTests(unittest.TestCase):
    def test_the_three_pinned_first_food_cells(self):
        self.assertEqual(Game(1).food, (25, 6))
        self.assertEqual(Game(42).food, (34, 6))
        self.assertEqual(Game(7).food, (8, 5))

    def test_a_placement_consumes_exactly_one_draw(self):
        rng = Lcg(42)
        snake = [(20, 10), (19, 10), (18, 10)]
        place(snake, rng)
        after_one = rng.state
        rng2 = Lcg(42)
        rng2.next()
        self.assertEqual(after_one, rng2.state)

    def test_a_full_board_places_nothing_and_draws_nothing(self):
        full = [(x, y) for y in range(HEIGHT) for x in range(WIDTH)]
        rng = Lcg(3)
        before = rng.state
        self.assertIsNone(place(full, rng))
        self.assertEqual(rng.state, before)

    def test_food_never_lands_on_the_snake_and_always_lands_on_the_board(self):
        snake = [(20, 10), (19, 10), (18, 10)]
        rng = Lcg(20250820)
        for _ in range(1000):
            cell = place(snake, rng)
            self.assertNotIn(cell, snake)
            self.assertTrue(0 <= cell[0] < WIDTH and 0 <= cell[1] < HEIGHT)

    def test_the_generator_is_consumed_for_food_and_nothing_else(self):
        game = Game(42)
        before = game.rng.state
        for _ in range(10):
            game.tick()
        self.assertEqual(game.food_eaten, 0)
        self.assertEqual(game.rng.state, before)


class InitialStateTests(unittest.TestCase):
    def test_a_new_game_matches_the_specification(self):
        game = Game(42)
        self.assertEqual(game.snake, [(20, 10), (19, 10), (18, 10)])
        self.assertEqual(game.direction, "RIGHT")
        self.assertEqual(game.pending, "RIGHT")
        self.assertEqual((game.score, game.ticks, game.food_eaten), (0, 0, 0))
        self.assertEqual(game.status, "alive")
        self.assertFalse(game.paused)
        self.assertEqual(game.restarts, 0)


class MovementTests(unittest.TestCase):
    def test_an_ordinary_tick_prepends_the_head_and_drops_the_tail(self):
        game = Game(42)
        game.tick()
        self.assertEqual(game.snake, [(21, 10), (20, 10), (19, 10)])
        self.assertEqual(game.ticks, 1)
        self.assertEqual(len(game.snake), 3)

    def test_eating_grows_the_snake_scores_ten_and_replaces_the_food(self):
        game = replay(42, "UP\nTICK 4\nRIGHT\nTICK 14\n")
        self.assertEqual(game.status, "alive")
        self.assertEqual(game.score, 10)
        self.assertEqual(game.food_eaten, 1)
        self.assertEqual(len(game.snake), 4)
        self.assertEqual(game.snake[0], (34, 6))
        self.assertNotEqual(game.food, (34, 6))
        self.assertNotIn(game.food, game.snake)

    def test_each_of_the_four_walls_ends_the_game_without_moving_the_snake(self):
        for directive, direction in (
            ("TICK 40\n", "RIGHT"),
            ("UP\nTICK 20\n", "UP"),
            ("DOWN\nTICK 20\n", "DOWN"),
            ("UP\nTICK 1\nLEFT\nTICK 40\n", "LEFT"),
        ):
            game = replay(42, directive)
            self.assertEqual(game.status, "dead_wall", directive)
            self.assertEqual(game.direction, direction, directive)

    def test_a_wall_death_counts_its_tick_and_leaves_the_snake_where_it_was(self):
        game = replay(42, "UP\nTICK 20\n")
        self.assertEqual(game.ticks, 11)
        self.assertEqual(game.snake[0], (20, 0))
        self.assertEqual(len(game.snake), 3)

    def test_the_east_wall_vector_is_seed_independent(self):
        for seed in (1, 7, 42, 999, 20250820):
            game = replay(seed, "TICK 40\n")
            self.assertEqual(
                (game.status, game.direction, game.ticks),
                ("dead_wall", "RIGHT", 20),
                seed,
            )

    def test_running_into_a_body_segment_ends_the_game(self):
        game = Game(42)
        game.snake = [(5, 5), (4, 5), (4, 6), (5, 6), (6, 6)]
        game.food = (0, 0)
        game.direction = "RIGHT"
        game.pending = "DOWN"
        game.tick()
        self.assertEqual(game.status, "dead_self")
        self.assertEqual(game.ticks, 1)
        self.assertEqual(game.snake, [(5, 5), (4, 5), (4, 6), (5, 6), (6, 6)])

    def test_entering_the_cell_the_tail_vacates_is_legal(self):
        game = Game(42)
        game.snake = [(5, 5), (4, 5), (4, 6), (5, 6)]
        game.food = (0, 0)
        game.direction = "RIGHT"
        game.pending = "DOWN"
        game.tick()
        self.assertEqual(game.status, "alive")
        self.assertEqual(game.snake, [(5, 6), (5, 5), (4, 5), (4, 6)])


class DirectionTests(unittest.TestCase):
    def test_the_exact_reverse_is_refused(self):
        game = replay(42, "LEFT\nTICK 1\n")
        self.assertEqual(game.direction, "RIGHT")
        self.assertEqual(game.snake[0], (21, 10))

    def test_two_directives_between_ticks_cannot_reverse_the_snake(self):
        game = replay(42, "UP\nLEFT\nTICK 1\n")
        self.assertEqual(game.direction, "UP")
        self.assertEqual(game.snake[0], (20, 9))

    def test_the_last_accepted_direction_wins(self):
        game = replay(42, "UP\nDOWN\nTICK 1\n")
        self.assertEqual(game.direction, "DOWN")
        self.assertEqual(game.snake[0], (20, 11))


class PauseTests(unittest.TestCase):
    def test_paused_ticks_are_consumed_and_ignored(self):
        game = replay(42, "TICK 3\nPAUSE\nTICK 5\nPAUSE\nTICK 2\n")
        self.assertEqual(game.ticks, 5)
        self.assertFalse(game.paused)

    def test_a_replay_can_end_paused(self):
        game = replay(42, "TICK 3\nPAUSE\nTICK 5\n")
        self.assertEqual(game.ticks, 3)
        self.assertTrue(game.paused)


class QuitAndRestartTests(unittest.TestCase):
    def test_quit_on_a_running_game_reports_quit_and_stops_the_script(self):
        game = replay(42, "TICK 5\nQUIT\nTICK 5\n")
        self.assertEqual(game.status, "quit")
        self.assertEqual(game.ticks, 5)

    def test_quit_after_a_death_keeps_the_terminal_status(self):
        game = replay(42, "TICK 40\nQUIT\n")
        self.assertEqual(game.status, "dead_wall")
        self.assertEqual(game.ticks, 20)

    def test_ticks_after_a_death_are_consumed_and_ignored(self):
        self.assertEqual(replay(42, "TICK 40\nTICK 40\n").ticks, 20)

    def test_restart_is_a_no_op_while_the_game_is_alive(self):
        game = replay(42, "RESTART\nTICK 2\n")
        self.assertEqual(game.restarts, 0)
        self.assertEqual(game.ticks, 2)

    def test_restart_resets_the_game_and_replays_the_same_food(self):
        game = replay(42, "TICK 40\nRESTART\nTICK 3\n")
        self.assertEqual(game.status, "alive")
        self.assertEqual(game.restarts, 1)
        self.assertEqual(game.ticks, 3)
        self.assertEqual(game.score, 0)
        self.assertEqual(game.food, (34, 6))
        self.assertEqual(game.snake[0], (23, 10))


class ScriptTests(unittest.TestCase):
    def test_comments_blank_lines_and_padding_are_ignored(self):
        self.assertEqual(
            parse("# note\n\n   \n\tTICK   3\t\n# tail\n"), [("TICK", 3)]
        )

    def test_every_token_parses_with_a_count_of_one(self):
        self.assertEqual(
            parse("UP\nDOWN\nLEFT\nRIGHT\nPAUSE\nQUIT\nRESTART\nTICK\n"),
            [
                ("UP", 1),
                ("DOWN", 1),
                ("LEFT", 1),
                ("RIGHT", 1),
                ("PAUSE", 1),
                ("QUIT", 1),
                ("RESTART", 1),
                ("TICK", 1),
            ],
        )

    def test_a_bad_directive_is_refused(self):
        for text in ("NORTH\n", "tick\n", "TICK 0\n", "TICK -1\n", "TICK two\n", "PAUSE 2\n"):
            with self.assertRaises(ScriptError, msg=text):
                parse(text)


class SummaryTests(unittest.TestCase):
    def test_the_worked_example_reproduces_byte_for_byte(self):
        produced = line(42, "TICK\n")
        self.assertEqual(len(WORKED_EXAMPLE), 1061)
        self.assertEqual(produced, WORKED_EXAMPLE)

    def test_every_cell_in_the_summary_is_a_list(self):
        got = fields(replay(42, "TICK 3\n"))
        self.assertEqual(got["schema"], SCHEMA)
        self.assertIsInstance(got["head"], list)
        self.assertIsInstance(got["food"], list)
        self.assertIsInstance(got["snake"], list)
        for cell in got["snake"]:
            self.assertIsInstance(cell, list)
            self.assertEqual(len(cell), 2)

    def test_the_structural_invariants_hold_over_a_long_replay(self):
        got = fields(replay(42, CHASE_42))
        board = got["board"]
        self.assertEqual(len(board), 819)
        self.assertEqual(board.count("/"), HEIGHT - 1)
        self.assertEqual(board.count("@"), 1)
        self.assertEqual(board.count("#"), got["length"] - 1)
        self.assertEqual(board.count("*"), 0 if got["food"] is None else 1)
        self.assertEqual(got["head"], got["snake"][0])
        self.assertEqual(len(got["snake"]), got["length"])
        self.assertEqual(len({tuple(c) for c in got["snake"]}), got["length"])
        self.assertEqual(got["score"], 10 * got["food_eaten"])
        self.assertEqual(board, render(replay(42, CHASE_42).snake, replay(42, CHASE_42).food))

    def test_a_replay_is_reproducible(self):
        self.assertEqual(line(42, CHASE_42), line(42, CHASE_42))

    def test_the_seed_forty_two_chase_matches_its_recorded_summary(self):
        got = fields(replay(42, CHASE_42))
        self.assertEqual(got["ticks"], 63)
        self.assertEqual(got["food_eaten"], 4)
        self.assertEqual(got["score"], 40)
        self.assertEqual(got["length"], 7)
        self.assertEqual(got["status"], "alive")
        self.assertEqual(got["direction"], "RIGHT")
        self.assertEqual(got["head"], [8, 1])
        self.assertEqual(got["food"], [39, 3])
        self.assertEqual(
            got["snake"],
            [[8, 1], [7, 1], [6, 1], [5, 1], [4, 1], [3, 1], [2, 1]],
        )

    def test_the_seed_one_chase_matches_its_recorded_summary(self):
        got = fields(replay(1, CHASE_1))
        self.assertEqual(got["ticks"], 36)
        self.assertEqual(got["food_eaten"], 3)
        self.assertEqual(got["score"], 30)
        self.assertEqual(got["length"], 6)
        self.assertEqual(got["direction"], "LEFT")
        self.assertEqual(got["head"], [13, 15])
        self.assertEqual(got["food"], [25, 0])
        self.assertEqual(
            got["snake"],
            [[13, 15], [14, 15], [15, 15], [16, 15], [17, 15], [18, 15]],
        )


if __name__ == "__main__":
    unittest.main()
