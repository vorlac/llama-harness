; case display-052-array
; expect exit=0 stdout="[\"\\r\"]\n"
.func main arity=0 locals=0
  PUSH_STR "\r"
  NEW_ARRAY 1
  PRINT
  RET
.end
