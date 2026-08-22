"""Splitting an amount across weighted destinations."""

import unittest

from ledger.allocation import allocate, allocate_by_amounts, allocate_evenly

SPLIT_CASES = [
    (100, [1, 1, 1]),
    (10, [1, 1, 1]),
    (1, [1, 1]),
    (99, [2, 1]),
    (13675, [1, 1, 1, 1]),
    (13675, [3, 1]),
    (5, [1, 1, 1, 1, 1, 1]),
    (72341, [5, 3, 2]),
    (-100, [1, 1, 1]),
    (-13675, [3, 1]),
]


class AllocationTests(unittest.TestCase):
    def test_shares_add_up_to_the_amount_being_split(self):
        for total, weights in SPLIT_CASES:
            with self.subTest(total=total, weights=weights):
                self.assertEqual(sum(allocate(total, weights)), total)

    def test_even_split_shares_differ_by_at_most_one_minor_unit(self):
        for parts in (2, 3, 4, 5, 6, 7):
            with self.subTest(parts=parts):
                shares = allocate_evenly(1000, parts)
                self.assertEqual(sum(shares), 1000)
                self.assertLessEqual(max(shares) - min(shares), 1)

    def test_odd_amount_split_three_ways_keeps_every_minor_unit(self):
        self.assertEqual(sorted(allocate_evenly(100, 3)), [33, 33, 34])

    def test_negative_amounts_split_with_the_same_magnitude(self):
        positive = allocate(-100, [1, 1, 1])
        self.assertEqual(sum(positive), -100)
        self.assertTrue(all(share <= 0 for share in positive))

    def test_shares_follow_the_weight_ratios(self):
        self.assertEqual(allocate(99, [2, 1]), [66, 33])
        self.assertEqual(allocate(1200, [1, 1, 1, 1]), [300, 300, 300, 300])
        self.assertEqual(allocate(600, [3, 2, 1]), [300, 200, 100])

    def test_shares_are_returned_in_the_order_of_the_weights(self):
        self.assertEqual(allocate(600, [1, 2, 3]), [100, 200, 300])

    def test_a_single_destination_receives_the_whole_amount(self):
        self.assertEqual(allocate(12345, [1]), [12345])
        self.assertEqual(allocate(-12345, [7]), [-12345])

    def test_zero_splits_into_zeroes(self):
        self.assertEqual(allocate(0, [1, 2, 3]), [0, 0, 0])

    def test_allocate_by_amounts_weighs_by_magnitude(self):
        self.assertEqual(allocate_by_amounts(120, [10, -20, 30]), [20, 40, 60])

    def test_weights_must_be_positive(self):
        with self.assertRaises(ValueError):
            allocate(100, [1, 0, 1])
        with self.assertRaises(ValueError):
            allocate(100, [-1, 2])

    def test_at_least_one_weight_is_required(self):
        with self.assertRaises(ValueError):
            allocate(100, [])
