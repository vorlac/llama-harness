; case display-040-array
; expect exit=0 stdout="[\"a\"]\n"
.func main arity=0 locals=0
  PUSH_STR "a"
  NEW_ARRAY 1
  PRINT
  RET
.end
