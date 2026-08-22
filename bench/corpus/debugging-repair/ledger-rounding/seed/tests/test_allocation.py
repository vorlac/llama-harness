"""Splitting an amount across weighted destinations."""

import unittest

from ledger.allocation import allocate, allocate_by_amounts, allocate_evenly


class AllocationTests(unittest.TestCase):
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
