package com.example.demo.repository;

public final class QueryConstants {

    public static final String ACTIVE_USER_FILTER = "u.active = true";

    public static final String ACTIVE_USER_FILTER_MULTIPLE_LINE =
    "u.active = true" + 
    " AND u.id = :id "+
    "ORDER BY u.id DESC";

    public static final String ACTIVE_USER_FILTER_TEXT_BLOCK =
        """
        u.active = true
        AND u.age = 18
        """;

    public static final String vw_clx_accountmanagementfees_frequency_merchant =
    "SELECT CONCAT(abf.mid, '-', abf.seq_no) AS mid_seq_key, " +
    "       abf.mid, " +
    "       abf.ind_f, " +
    "       fsh.major_category, " +
    "       fsh.minor_category, " +
    "       fsh.sequence_number, " +
    "       fsh.description " +
    "FROM accessone_billing_frequency abf " +
    "    INNER JOIN fee_sequence_hierarchy fsh ON abf.seq_no = fsh.sequence_number " +
    "WHERE abf.mid = :merchantId " +
    "     AND (abf.ind_f = 'D')" +
    "     AND fsh.deleted IS FALSE " +
    "     AND (abf.deleted IS FALSE) " +
    "     AND (fsh.major_category = 'Fee') " +
    "     AND (fsh.minor_category = 'Account Management Fees') ";

    private QueryConstants() {
    }
}
