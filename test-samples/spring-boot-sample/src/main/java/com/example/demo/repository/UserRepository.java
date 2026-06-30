package com.example.demo.repository;

import com.example.demo.entity.User;
import com.example.demo.repository.QueryConstants;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import static com.example.demo.repository.QueryConstants.vw_clx_accountmanagementfees_frequency_merchant;

import java.util.List;
import java.util.Optional;

public interface UserRepository extends JpaRepository<User, Long> {

    String ACTIVE_JPQL_SUFFIX = " AND u.active = true";

    List<User> findByFirstNameAndAge(String firstName, Integer age);

    List<User> findByInvalidField(String value);

    @Query("SELECT u FROM User u WHERE u.email = :email")
    Optional<User> findByEmailJpql(@Param("email") String email);

    @Query(value = "SELECT * FROM users WHERE email = :email", nativeQuery = true)
    Optional<User> findByEmailNative(@Param("email") String email);

    @Query("SELECT u FROM User u WHERE u.email = :email" + ACTIVE_JPQL_SUFFIX)
    Optional<User> findActiveByEmailJpql(@Param("email") String email);

    @Query("SELECT u FROM User u WHERE " + QueryConstants.ACTIVE_USER_FILTER)
    List<User> findActiveUsers();

    @Query("SELECT u FROM User u WHERE " + QueryConstants.ACTIVE_USER_FILTER_MULTIPLE_LINE)
    List<User> findActiveUsersMultipleLines(Long id);

    @Query(value = "WITH fees AS (" +
            "WITH vw_clx_accountmanagementfees_frequency AS (" + vw_clx_accountmanagementfees_frequency_merchant + ") " +
    ")" + 
    "SELECT * FROM fees", nativeQuery = true)
    List<User> findActiveUsersTextBlock();
}
