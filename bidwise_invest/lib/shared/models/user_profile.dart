enum UserRole { client, admin }

class UserProfile {
  final String id;
  final String? email;
  final UserRole role;
  final String? fullName;
  final String? countyPreference;

  const UserProfile({
    required this.id,
    this.email,
    required this.role,
    this.fullName,
    this.countyPreference,
  });

  bool get isAdmin => role == UserRole.admin;

  factory UserProfile.fromJson(Map<String, dynamic> json) {
    return UserProfile(
      id: json['id'] as String,
      email: json['email'] as String?,
      role: json['role'] == 'admin' ? UserRole.admin : UserRole.client,
      fullName: json['full_name'] as String?,
      countyPreference: json['county_preference'] as String?,
    );
  }
}
