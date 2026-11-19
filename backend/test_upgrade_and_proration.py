import datetime
from usage import calculate_upgrade_proration

def test_proration():
    print("=== Testing Proration & Downgrade Logic ===")

    # Day 0: User just bought FLASH ($5). 30 days remaining.
    flash_sub_day0 = {
        "plan_code": "FLASH",
        "plan_name": "Flash Plan",
        "price_usd": 5.00,
        "expires_at": (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=30)).isoformat()
    }

    # Upgrading to PRO ($8) on Day 0
    p1 = calculate_upgrade_proration(flash_sub_day0, 8.00)
    print("FLASH -> PRO on Day 0:", p1)
    assert p1["is_upgrade"] is True
    assert p1["remaining_days"] == 30
    assert p1["remaining_credit"] == 5.00
    assert p1["final_price"] == 3.00, f"Expected 3.00, got {p1['final_price']}"

    # Day 15: User on FLASH ($5). 15 days remaining. Credit = $2.50.
    flash_sub_day15 = {
        "plan_code": "FLASH",
        "plan_name": "Flash Plan",
        "price_usd": 5.00,
        "expires_at": (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=15)).isoformat()
    }
    p2 = calculate_upgrade_proration(flash_sub_day15, 8.00)
    print("FLASH -> PRO on Day 15:", p2)
    assert p2["is_upgrade"] is True
    assert p2["remaining_days"] == 15
    assert p2["remaining_credit"] == 2.50
    assert p2["final_price"] == 5.50, f"Expected 5.50, got {p2['final_price']}"

    # Day 15: User on PRO ($8). 15 days remaining. Credit = $4.00.
    pro_sub_day15 = {
        "plan_code": "PRO",
        "plan_name": "Pro Plan",
        "price_usd": 8.00,
        "expires_at": (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=15)).isoformat()
    }

    # Upgrade to PRO_MAX ($10) on Day 15
    p3 = calculate_upgrade_proration(pro_sub_day15, 10.00)
    print("PRO -> PRO_MAX on Day 15:", p3)
    assert p3["is_upgrade"] is True
    assert p3["remaining_days"] == 15
    assert p3["remaining_credit"] == 4.00
    assert p3["final_price"] == 6.00, f"Expected 6.00, got {p3['final_price']}"

    # Upgrade to UNLIMITED ($15) on Day 15
    p4 = calculate_upgrade_proration(pro_sub_day15, 15.00)
    print("PRO -> UNLIMITED on Day 15:", p4)
    assert p4["is_upgrade"] is True
    assert p4["remaining_days"] == 15
    assert p4["remaining_credit"] == 4.00
    assert p4["final_price"] == 11.00, f"Expected 11.00, got {p4['final_price']}"

    # Downgrade attempt: PRO ($8) -> FLASH ($5)
    p5 = calculate_upgrade_proration(pro_sub_day15, 5.00)
    print("PRO -> FLASH on Day 15 (Downgrade):", p5)
    assert p5["is_downgrade"] is True
    assert p5["is_upgrade"] is False
    assert "locked" in p5.get("blocked_reason", "").lower()

    print("ALL TESTS PASSED SUCCESSFULLY! Math and Downgrade blocks match 100% of requirements.")

if __name__ == "__main__":
    test_proration()
