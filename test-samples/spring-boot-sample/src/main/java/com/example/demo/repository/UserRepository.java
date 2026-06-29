package com.example.demo.repository;

import com.example.demo.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface UserRepository extends JpaRepository<User, Long> {

    List<User> findByFirstNameAndAge(String firstName, Integer age);

    List<User> findByInvalidField(String value);

    @Query("SELECT u FROM User u WHERE u.email = :email")
    Optional<User> findByEmailJpql(@Param("email") String email);

    @Query(value = "SELECT * FROM users WHERE email = :email", nativeQuery = true)
    Optional<User> findByEmailNative(@Param("email") String email);

    @Query(value = "SELECT * FROM users " +
           "WHERE email = :email", nativeQuery = true)
    Optional<User> findByEmailConcat(@Param("email") String email);

    @Query(value = """
        SELECT id, first_name, email
        FROM users
        WHERE age > :minAge
        ORDER BY first_name
        """, nativeQuery = true)
    List<User> findAdults(@Param("minAge") int minAge);
}
