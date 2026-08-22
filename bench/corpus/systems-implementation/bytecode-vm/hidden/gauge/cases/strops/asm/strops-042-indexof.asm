; case strops-042-indexof
; expect exit=0 stdout="-1\n"
.func main arity=0 locals=0
  PUSH_STR "abc"
  PUSH_STR "abcd"
  INDEXOF
  PRINT
  RET
.end
