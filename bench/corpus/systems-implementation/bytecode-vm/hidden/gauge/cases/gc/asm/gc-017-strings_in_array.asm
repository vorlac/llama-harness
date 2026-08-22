; case gc-017-strings_in_array
; expect exit=0 stdout="3\n0\n"
.func main arity=0 locals=1
  PUSH_STR "a"
  PUSH_STR "b"
  CONCAT
  PUSH_STR "c"
  PUSH_STR "d"
  CONCAT
  NEW_ARRAY 2
  STORE_LOCAL 0
  GCLIVE
  PRINT
  PUSH_NIL
  STORE_LOCAL 0
  GCLIVE
  PRINT
  RET
.end
